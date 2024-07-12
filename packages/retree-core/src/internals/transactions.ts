export class TransactionStates {
    /**
     * @internal
     * NOTE: It's important this only gets set in a synchronous operation.
     * When true, we will skip emitting changes.
     */
    static skipEmit: boolean = false;
    /**
     * @internal
     * NOTE: It's important this only gets set in a synchronous operation.
     * When true, we will skip reproxying nodes.
     */
    static skipReproxy: boolean = false;
}
