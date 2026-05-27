import { ignore, ReactiveNode } from "@retreejs/core";
import { createRetreeConvexMutation } from "../mutations";
import {
    IConvexClient,
    MutationReference,
    RetreeConvexMutation,
} from "../types";

export abstract class BaseConvexNode extends ReactiveNode {
    @ignore
    protected readonly client: IConvexClient;

    constructor(client: IConvexClient) {
        super();
        this.client = client;
    }

    protected mutation<Mutation extends MutationReference>(
        mutation: Mutation
    ): RetreeConvexMutation<Mutation> {
        return createRetreeConvexMutation(this.client, mutation);
    }
}
