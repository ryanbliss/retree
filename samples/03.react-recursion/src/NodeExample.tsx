import { FC, memo } from "react";
import { useNode } from "@retreejs/react";
import { Retree } from "@retreejs/core";
import { IMemoize } from "./interfaces";
import { Card, Tree } from "./node-state";

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
                <button onClick={_card.iterate}>count is {card.count}</button>
                <button onClick={_card.iterateSilent}>silent iterate</button>
                <button onClick={_card.iterateTransaction}>5x iterate transaction</button>
                <button onClick={_card.addChild}>Add child</button>
                <button onClick={_card.addChildSilent}>Silent add child</button>
            </div>
            {memoize && <CardList list={_card.list} memoize={memoize} />}
            {!memoize && <_CardList list={_card.list} memoize={memoize} />}
        </div>
    );
};
const ViewCard = memo(_ViewCard);

// Setup Retree with our root node
const appTree = Retree.use(new Tree("useNode (optimal performance)"));

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
