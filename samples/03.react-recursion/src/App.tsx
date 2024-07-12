import "./App.css";
import NodeExample from "./NodeExample";
import TreeExample from "./TreeExample";
import { useNode } from "@retreejs/react";
import { globalState } from "./global-state";

function App() {
    const state = useNode(globalState);
    return (
        <div>
            <h1>{"Recursion examples"}</h1>
            <div>
                <label>
                    Memoize components
                    <input
                        type="checkbox"
                        checked={state.memoize}
                        onChange={(e) => (state.memoize = e.target.checked)}
                    />
                </label>
                <label>
                    Skip reproxy when silent
                    <input
                        type="checkbox"
                        checked={state.silentSkipReproxy}
                        onChange={(e) =>
                            (state.silentSkipReproxy = e.target.checked)
                        }
                    />
                </label>
            </div>
            <NodeExample memoize={state.memoize} />
            <TreeExample memoize={state.memoize} />
        </div>
    );
}

export default App;
