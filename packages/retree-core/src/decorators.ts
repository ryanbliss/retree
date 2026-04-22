import { COLLECTED_KEYS_SYMBOL, ReactiveNode } from "./ReactiveNode";

export function retreeIgnore(
    _value: undefined,
    context: ClassFieldDecoratorContext
): void | ((this: ReactiveNode, value: any) => any) {
    context.addInitializer(function () {
        if (!(this instanceof ReactiveNode)) return;
        this[COLLECTED_KEYS_SYMBOL].add(context.name);
    });
    return;
}
