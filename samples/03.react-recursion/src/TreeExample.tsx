import { FC, memo } from "react";
import { useTree } from "@retreejs/react";
import { Retree } from "@retreejs/core";
import { IMemoize } from "./interfaces";
import { Card, Tree } from "./node-state";

const _CardList: FC<
    {
        list: Card[];
    } & IMemoize
> = ({ list, memoize }) => {
    return (
        <>
            {memoize &&
                list.map((c) => {
                    return <ViewCard key={c.id} card={c} memoize={memoize} />;
                })}
            {!memoize &&
                list.map((c) => {
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
    return (
        <div className="card">
            <div className="card-buttons">
                <button onClick={card.iterate}>count is {card.count}</button>
                <button onClick={card.iterateSilent}>silent iterate</button>
                <button onClick={card.iterateTransaction}>5x iterate transaction</button>
                <button onClick={card.addChild}>Add child</button>
                <button onClick={card.addChildSilent}>Silent add child</button>
            </div>
            {memoize && <CardList list={card.list} memoize={memoize} />}
            {!memoize && <_CardList list={card.list} memoize={memoize} />}
        </div>
    );
};
const ViewCard = memo(_ViewCard);

// Setup Retree with our root node
const appTree = Retree.use(new Tree("useTree (ease of use)"));

const TreeExample: FC<IMemoize> = ({ memoize }) => {
    const root = useTree(appTree);
    return (
        <div>
            <h2>{root.title}</h2>
            {memoize && <ViewCard card={root.card} memoize={memoize} />}
            {!memoize && <_ViewCard card={root.card} memoize={memoize} />}
        </div>
    );
};

export default TreeExample;
