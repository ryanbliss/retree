import { v4 as uuid } from "uuid";
import { Retree } from "@retreejs/core";
import { globalState } from "./global-state";

export class Card {
    public readonly id = uuid();
    public list: Array<Card> = [];
    private get multiplier() {
        return this.grandparent?.count ?? 1;
    }
    constructor(public count: number) {}

    public get grandparent(): Card | undefined {
        // Parent is either a Array<Card> or Tree
        const parent = Retree.parent(this);
        if (!parent) return undefined;
        // If parent is Array<Card>, we expect no grandparent to exist.
        // When we have a grandparent, use that Card.count value as our multipler.
        const grandparent = Retree.parent(parent);
        if (grandparent instanceof Card) return grandparent;
        return undefined;
    }

    iterate() {
        this.count += 1 * this.multiplier;
    }

    iterateSilent() {
        Retree.runSilent(() => {
            this.iterate();
        }, globalState.silentSkipReproxy);
    }

    addChild() {
        // Start our counter at 1 or this.count * this.multipier, whichever is higher
        const startCount = Math.max(1, this.count * this.multiplier);
        this.list.unshift(new Card(startCount));
    }

    addChildSilent() {
        Retree.runSilent(() => {
            this.addChild();
        }, globalState.silentSkipReproxy);
    }

    iterateFiveTimes() {
        // Queue up multiple changes to happen in a single change
        let i = 0;
        while (i < 5) {
            this.iterate();
            i++;
        }
        this.grandparent?.iterateFiveTimes();
    }

    iterateTransaction() {
        Retree.runTransaction(() => {
            this.iterateFiveTimes();
        });
    }

    reparentUp() {
        // Cannot reparent object if it is the root
        const grandparent = this.grandparent;
        if (!grandparent) return;
        // Cannot reparent object if it is already a child of the root
        const greatGrandparent = grandparent.grandparent;
        if (!greatGrandparent) return;
        const index = grandparent.list.findIndex((v) => v.id === this.id);
        if (index < 0) return;
        Retree.runTransaction(() => {
            grandparent.list.splice(index, 1);
            greatGrandparent.list.unshift(this);
            console.log(grandparent.list, greatGrandparent.list);
        });
    }

    swapChildList() {
        if (this.list.length < 2) return;
        // Far from elegant, but it is possible to swap parents between two different nodes
        Retree.runTransaction(() => {
            const card1 = this.list[0];
            const card1List = card1.list;
            const card2 = this.list[1];
            const card2List = card2.list;
            card1.list = [];
            card2.list = [];
            card1.list = card2List;
            card2.list = card1List;
        });
    }
}

export class Tree {
    constructor(public readonly title: string) {}
    public card: Card = new Card(1);
}
