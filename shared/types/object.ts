export type Keys<O extends Object> = keyof O;
export type Values<O extends Object> = O[Keys<O>];