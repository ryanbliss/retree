import { FC, memo } from "react";
import { useNode } from "@retreejs/react";
import { Retree } from "@retreejs/core";
import { IMemoize } from "./interfaces";
import { Card, Tree } from "./node-state";
import { globalState } from "./global-state";

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
                    return <ViewCard key={c.id} card={c} />;
                })}
            {!memoize &&
                _list.map((c) => {
                    return <_ViewCard key={c.id} card={c} />;
                })}
        </>
    );
};
const CardList = memo(_CardList);

const _ViewCard: FC<{
    card: Card;
}> = ({ card }) => {
    const _card = useNode(card);
    return (
        <div className="card">
            <div className="card-stats">{`counter: ${_card.count}`}</div>
            <div className="card-buttons">
                <button onClick={_card.iterate}>{"+count"}</button>
                <button onClick={_card.iterateSilent}>
                    {"+count (silent)"}
                </button>
                <button onClick={_card.iterateTransaction}>
                    {"bulk transaction"}
                </button>
                <button onClick={_card.addChild}>{"+child"}</button>
                <button onClick={_card.addChildSilent}>
                    {"+child (silent)"}
                </button>
                <button
                    onClick={_card.reparentUp}
                    disabled={!card.grandparent?.grandparent}
                >
                    {"escape parent"}
                </button>
                <button
                    disabled={!_card.canSwapChildList}
                    onClick={_card.swapChildList}
                >
                    {"swap child lists"}
                </button>
            </div>
            {globalState.memoize && (
                <CardList list={_card.list} memoize={globalState.memoize} />
            )}
            {!globalState.memoize && (
                <_CardList list={_card.list} memoize={globalState.memoize} />
            )}
        </div>
    );
};
const ViewCard = memo(_ViewCard);

// Setup Retree with our root node
const appTree = Retree.use(new Tree("useNode (optimal performance)"));

const _NodeExample: FC = () => {
    const root = useNode(appTree);
    return (
        <div>
            <h2>{root.title}</h2>
            {globalState.memoize && <ViewCard card={root.card} />}
            {!globalState.memoize && <_ViewCard card={root.card} />}
        </div>
    );
};
const NodeExample = memo(_NodeExample);

export default NodeExample;
