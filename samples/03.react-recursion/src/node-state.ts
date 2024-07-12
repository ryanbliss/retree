import { v4 as uuid } from "uuid";
import { Retree } from "@retreejs/core";
import { globalState } from "./global-state";

export class Card {
    public readonly id = uuid();
    public list: Array<Card> = [];
    private get multiplier() {
        // Parent is either a Array<Card> or Tree
        const parent = Retree.parent(this);
        if (!parent) return 1;
        // If parent is Array<Card>, we expect no grandparent to exist.
        // When we have a grandparent, use that Card.count value as our multipler.
        const grandparent = Retree.parent(parent);
        return grandparent instanceof Card ? grandparent.count : 1;
    }
    constructor(public count: number) {}

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
        this.list.push(new Card(startCount));
    }

    addChildSilent() {
        Retree.runSilent(() => {
            this.addChild();
        }, globalState.silentSkipReproxy);
    }
}

export class Tree {
    constructor(public readonly title: string) {}
    public card: Card = new Card(0);
}


