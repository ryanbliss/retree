import { Retree } from "@retreejs/core";

export class GlobalState {
    memoize = true;
    silentSkipReproxy = true;
}
export const globalState = Retree.use(new GlobalState());
