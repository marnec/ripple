export type Keys<O extends object> = keyof O;
export type Values<O extends object> = O[Keys<O>];