import { FC, memo } from "react";
import { useTree } from "@retreejs/react";
import { Retree } from "@retreejs/core";
import { IMemoize } from "./interfaces";
import { Card, Tree } from "./node-state";
import { globalState } from "./global-state";

const _CardList: FC<
    {
        list: Card[];
    } & IMemoize
> = ({ list, memoize }) => {
    return (
        <>
            {memoize &&
                list.map((c) => {
                    return <ViewCard key={c.id} card={c} />;
                })}
            {!memoize &&
                list.map((c) => {
                    return <_ViewCard key={c.id} card={c} />;
                })}
        </>
    );
};
const CardList = memo(_CardList);

const _ViewCard: FC<{
    card: Card;
}> = ({ card }) => {
    return (
        <div className="card">
            <div className="card-stats">{`counter: ${card.count}`}</div>
            <div className="card-buttons">
                <button onClick={card.iterate}>{"+count"}</button>
                <button onClick={card.iterateSilent}>
                    {"+count (silent)"}
                </button>
                <button onClick={card.iterateTransaction}>
                    {"bulk transaction"}
                </button>
                <button onClick={card.addChild}>{"+child"}</button>
                <button onClick={card.addChildSilent}>
                    {"+child (silent)"}
                </button>
                <button
                    onClick={card.reparentUp}
                    disabled={!card.grandparent?.grandparent}
                >
                    {"escape parent"}
                </button>
                <button
                    disabled={!card.canSwapChildList}
                    onClick={card.swapChildList}
                >
                    {"swap child lists"}
                </button>
            </div>
            {globalState.memoize && (
                <CardList list={card.list} memoize={globalState.memoize} />
            )}
            {!globalState.memoize && (
                <_CardList list={card.list} memoize={globalState.memoize} />
            )}
        </div>
    );
};
const ViewCard = memo(_ViewCard);

// Setup Retree with our root node
const appTree = Retree.use(new Tree("useTree (ease of use)"));

const _TreeExample: FC = () => {
    const root = useTree(appTree);
    return (
        <div>
            <h2>{root.title}</h2>
            {globalState.memoize && <ViewCard card={root.card} />}
            {!globalState.memoize && <_ViewCard card={root.card} />}
        </div>
    );
};
const TreeExample = memo(_TreeExample);

export default TreeExample;
