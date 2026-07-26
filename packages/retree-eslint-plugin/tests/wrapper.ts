import { ReactiveNode } from "@retreejs/core";

export { useNode as useProjectNode } from "@retreejs/react";
export { useRaw as useProjectRaw } from "@retreejs/react";

export class WrappedProjectNode extends ReactiveNode {
    public owner = { name: "Ada" };

    get dependencies() {
        return [this.owner];
    }
}
