export type Mutate = <T>(action: () => Promise<T>) => Promise<T | null>;
