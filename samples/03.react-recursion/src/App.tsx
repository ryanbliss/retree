import { Retree } from "@retreejs/core";
import "./App.css";
import NodeExample from "./NodeExample";
import TreeExample from "./TreeExample";
import { useNode } from "@retreejs/react";

class MemoState {
    memoize = true;
    toggle() {
        this.memoize = !this.memoize;
    }
}
const memoState = Retree.use(new MemoState());

function App() {
    const state = useNode(memoState);
    return (
        <div>
            <h1>{"Recursion examples"}</h1>
            <label>
                Memoize components
                <input
                    type="checkbox"
                    checked={state.memoize}
                    onChange={(e) => state.memoize = e.target.checked}
                />
            </label>
            <NodeExample memoize={state.memoize} />
            <TreeExample memoize={state.memoize} />
        </div>
    );
}

export default App;
