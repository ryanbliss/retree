import { FC, memo } from "react";
import { useTree } from "@retreejs/react";
import { isErrorLike } from "./utils";
import { Retree } from "@retreejs/core";
import "./App.css";

class CatFacts {
    public loading = false;
    public error: string | undefined = undefined;
    public fact: string | undefined;

    public async randomize() {
        this.loading = true;
        if (this.error) this.error = undefined;
        try {
            const data = await fetch("https://meowfacts.herokuapp.com/");
            const json = await data.json();
            this.fact = json.data[0];
        } catch (err) {
            this.error = isErrorLike(err) ? err.message : JSON.stringify(err);
        } finally {
            this.loading = false;
        }
    }
}

const _ViewCatFacts: FC<{ node: CatFacts }> = ({ node: catFacts }) => {
    if (catFacts.loading) {
        return <>Loading cat facts...</>;
    }
    if (catFacts.error) {
        return <>{catFacts.error}</>;
    }
    return (
        <div className="fact">
            <p>
                <strong>Cat fact: </strong>
                {catFacts.fact}
            </p>
            <button onClick={() => catFacts.randomize()}>
                {"Random fact"}
            </button>
        </div>
    );
};
const ViewCatFacts = memo(_ViewCatFacts);

class AppTree {
  public readonly appTitle = "Retree cat facts example";
  public facts: CatFacts = new CatFacts();
}
// Setup Retree root
const appTree = Retree.use(new AppTree());

function App() {
    const root = useTree(appTree);
    return (
        <div>
            <h1>{root.appTitle}</h1>
            <ViewCatFacts node={root.facts} />
        </div>
    );
}

export default App;
