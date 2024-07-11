import { FC, memo } from "react";
import { useNode } from "@retreejs/react";
import { v4 as uuid } from "uuid";
import { Retree } from "@retreejs/core";
import { IMemoize } from "./interfaces";

class Card {
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
    addChild() {
        // Start our counter at 1 or this.count * this.multipier, whichever is higher
        const startCount = Math.max(1, this.count * this.multiplier);
        this.list.push(new Card(startCount));
    }
}

const _CardList: FC<
    {
        list: Card[];
    } & IMemoize
> = ({ list, memoize }) => {
    const _list = useNode(list);
    return (
        <>
            {memoize &&
                _list.map((c) => {
                    return <ViewCard key={c.id} card={c} memoize={memoize} />;
                })}
            {!memoize &&
                _list.map((c) => {
                    return <_ViewCard key={c.id} card={c} memoize={memoize} />;
                })}
        </>
    );
};
const CardList = memo(_CardList);

const _ViewCard: FC<
    {
        card: Card;
    } & IMemoize
> = ({ card, memoize }) => {
    const _card = useNode(card);
    return (
        <div className="card">
            <div className="card-buttons">
                <button onClick={_card.iterate}>
                    count is {_card.count}
                </button>
                <button onClick={_card.addChild}>Add child</button>
            </div>
            {memoize && <CardList list={_card.list} memoize={memoize} />}
            {!memoize && <_CardList list={_card.list} memoize={memoize} />}
        </div>
    );
};
const ViewCard = memo(_ViewCard);

class Tree {
    public readonly title = "useNode (optimal performance)";
    public card: Card = new Card(0);
}
// Setup Retree with our root node
const appTree = Retree.use(new Tree());

const NodeExample: FC<IMemoize> = ({ memoize }) => {
    const root = useNode(appTree);
    return (
        <div>
            <h2>{root.title}</h2>
            {memoize && <ViewCard card={root.card} memoize={memoize} />}
            {!memoize && <_ViewCard card={root.card} memoize={memoize} />}
        </div>
    );
};

export default NodeExample;
