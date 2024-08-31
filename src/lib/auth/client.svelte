<script lang="ts">
    import { writable, derived, get } from 'svelte/store';
    import { signInViaProvider } from '@convex-dev/auth/server';
        import type { ConvexAuthActionsContext, TokenStorage } from "./index.svelte";
	import type { AuthClient } from './clientType';
	
    
    const VERIFIER_STORAGE_KEY = "__convexAuthOAuthVerifier";
    const JWT_STORAGE_KEY = "__convexAuthJWT";
    const REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken";
    const SERVER_STATE_FETCH_TIME_STORAGE_KEY = "__convexAuthServerStateFetchTime";
    
    function createAuthStore() {
        const token = writable<string | null>(null);
        const isLoading = writable(true);
        const isAuthenticated = derived(token, $token => $token !== null);
    
        return {
            token,
            isLoading,
            isAuthenticated,
            setToken: (newToken: string | null) => {
                token.set(newToken);
                isLoading.set(false);
            }
        };
    }
    
    export const authStore = createAuthStore();
    
    interface AuthProviderProps {
        client: AuthClient;
        serverState?: {
            _state: { token: string | null; refreshToken: string | null };
            _timeFetched: number;
        };
        onChange?: () => Promise<unknown>;
        storage: TokenStorage | null;
        storageNamespace: string;
        replaceURL: (relativeUrl: string) => void | Promise<void>;
        verbose?: boolean;
    }
    
    export function createAuthProvider(options: AuthProviderProps) {
        const { client, serverState, onChange, storage, storageNamespace, replaceURL, verbose = false } = options;
    
        const logVerbose = (message: string) => {
            if (verbose) {
                console.debug(`${new Date().toISOString()} ${message}`);
            }
        };
    
        const { storageSet, storageGet, storageRemove } = useNamespacedStorage(storage, storageNamespace);
    
        async function setToken(
            args:
                | { shouldStore: true; tokens: { token: string; refreshToken: string } }
                | { shouldStore: false; tokens: { token: string } }
                | { shouldStore: boolean; tokens: null }
        ) {
            const wasAuthenticated = get(authStore.token) !== null;
            let newToken: string | null;
    
            if (args.tokens === null) {
                if (args.shouldStore) {
                    await storageRemove(JWT_STORAGE_KEY);
                    await storageRemove(REFRESH_TOKEN_STORAGE_KEY);
                }
                newToken = null;
            } else {
                const { token: value } = args.tokens;
                if (args.shouldStore) {
                    const { refreshToken } = args.tokens as { token: string; refreshToken: string };
                    await storageSet(JWT_STORAGE_KEY, value);
                    await storageSet(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
                }
                newToken = value;
            }
    
            if (wasAuthenticated !== (newToken !== null)) {
                await onChange?.();
            }
    
            authStore.setToken(newToken);
        }
    
        async function verifyCodeAndSetToken(
            args: { code: string; verifier?: string } | { refreshToken: string }
        ) {
            const { tokens } = await client.unauthenticatedCall(
                "auth:signIn" as unknown as SignInAction,
                "code" in args
                    ? { params: { code: args.code }, verifier: args.verifier }
                    : args
            );
            logVerbose(`retrieved tokens, is null: ${tokens === null}`);
            await setToken({ shouldStore: true, tokens: tokens ?? null });
            return tokens !== null;
        }
    
        async function signIn(provider?: string, args?: FormData | Record<string, unknown>) {
            const params =
                args instanceof FormData
                    ? Object.fromEntries(args.entries())
                    : args ?? {};
    
            const verifier = (await storageGet(VERIFIER_STORAGE_KEY)) ?? undefined;
            await storageRemove(VERIFIER_STORAGE_KEY);
            const result = await client.authenticatedCall(
                "auth:signIn" as unknown as SignInAction,
                { provider, params, verifier }
            );
    
            if (result.redirect !== undefined) {
                const url = new URL(result.redirect);
                await storageSet(VERIFIER_STORAGE_KEY, result.verifier);
                // Do not redirect in React Native
                if (typeof window !== 'undefined' && window.location !== undefined) {
                    window.location.href = url.toString();
                }
                return { signingIn: false, redirect: url };
            } else if (result.tokens !== undefined) {
                const { tokens } = result;
                logVerbose(`signed in and got tokens, is null: ${tokens === null}`);
                await setToken({ shouldStore: true, tokens });
                return { signingIn: tokens !== null };
            }
            return { signingIn: false };
        }
    
        async function signOut() {
            try {
                await client.authenticatedCall(
                    "auth:signOut" as unknown as SignOutAction
                );
            } catch (error) {
                // Ignore any errors, they are usually caused by being
                // already signed out, which is ok.
            }
            logVerbose(`signed out, erasing tokens`);
            await setToken({ shouldStore: true, tokens: null });
        }
    
        async function fetchAccessToken({ forceRefreshToken }: { forceRefreshToken: boolean }) {
            if (forceRefreshToken) {
                const tokenBeforeLockAcquisition = get(authStore.token);
                return await browserMutex(REFRESH_TOKEN_STORAGE_KEY, async () => {
                    const tokenAfterLockAcquisition = get(authStore.token);
                    if (tokenAfterLockAcquisition !== tokenBeforeLockAcquisition) {
                        logVerbose(
                            `returning synced token, is null: ${tokenAfterLockAcquisition === null}`
                        );
                        return tokenAfterLockAcquisition;
                    }
                    const refreshToken =
                        (await storageGet(REFRESH_TOKEN_STORAGE_KEY)) ?? null;
                    if (refreshToken !== null) {
                        await storageRemove(REFRESH_TOKEN_STORAGE_KEY);
                        const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
                            event.preventDefault();
                            event.returnValue = true;
                        };
                        window.addEventListener("beforeunload", beforeUnloadHandler);
                        await verifyCodeAndSetToken({ refreshToken });
                        window.removeEventListener("beforeunload", beforeUnloadHandler);
                        logVerbose(
                            `returning retrieved token, is null: ${get(authStore.token) === null}`
                        );
                        return get(authStore.token);
                    } else {
                        logVerbose(`returning null, there is no refresh token`);
                        return null;
                    }
                });
            }
            return get(authStore.token);
        }
    
        function initialize() {
            if (typeof window === 'undefined') return; // Skip on server-side
    
            if (storage === undefined) {
                throw new Error(
                    "`localStorage` is not available in this environment, " +
                    "set the `storage` prop on `AuthProvider`!"
                );
            }
    
            const readStateFromStorage = async () => {
                const token = (await storageGet(JWT_STORAGE_KEY)) ?? null;
                logVerbose(`retrieved token from storage, is null: ${token === null}`);
                await setToken({
                    shouldStore: false,
                    tokens: token === null ? null : { token },
                });
            };
    
            if (serverState !== undefined) {
                const timeFetched = storageGet(SERVER_STATE_FETCH_TIME_STORAGE_KEY);
                const setTokensFromServerState = (
                    timeFetched: string | null | undefined
                ) => {
                    if (!timeFetched || serverState._timeFetched > +timeFetched) {
                        const { token, refreshToken } = serverState._state;
                        const tokens =
                            token === null || refreshToken === null
                                ? null
                                : { token, refreshToken };
                        storageSet(
                            SERVER_STATE_FETCH_TIME_STORAGE_KEY,
                            serverState._timeFetched.toString()
                        );
                        setToken({ tokens, shouldStore: true });
                    } else {
                        readStateFromStorage();
                    }
                };
    
                if (timeFetched instanceof Promise) {
                    timeFetched.then(setTokensFromServerState);
                } else {
                    setTokensFromServerState(timeFetched);
                }
    
                return;
            }
    
            const code = new URLSearchParams(window.location.search).get("code");
            if (code) {
                const url = new URL(window.location.href);
                url.searchParams.delete("code");
                (async () => {
                    await replaceURL(url.pathname + url.search + url.hash);
                    await signIn(undefined, { code });
                })();
            } else {
                readStateFromStorage();
            }
        }
    
        return {
            initialize,
            signIn,
            signOut,
            fetchAccessToken,
        };
    }
    
    function useNamespacedStorage(
        persistentStorage: TokenStorage | null,
        namespace: string
    ) {
        const storage = persistentStorage ?? createInMemoryStorage();
        const escapedNamespace = namespace.replace(/[^a-zA-Z0-9]/g, "");
        const storageKey = (key: string) => `${key}_${escapedNamespace}`;
    
        return {
            storageSet: (key: string, value: string) =>
                storage.setItem(storageKey(key), value),
            storageGet: (key: string) => storage.getItem(storageKey(key)),
            storageRemove: (key: string) => storage.removeItem(storageKey(key)),
        };
    }
    
    function createInMemoryStorage(): TokenStorage {
        const store = writable<Record<string, string>>({});
    
        return {
            getItem: (key) => get(store)[key] ?? null,
            setItem: (key, value) => {
                store.update(s => ({ ...s, [key]: value }));
            },
            removeItem: (key) => {
                store.update(({ [key]: _, ...rest }) => rest);
            },
        };
    }
    
    async function browserMutex<T>(
        key: string,
        callback: () => Promise<T>
    ): Promise<T> {
        const lockManager = (window?.navigator as any)?.locks;
        return lockManager !== undefined
            ? await lockManager.request(key, callback)
            : await callback();
    }
    
    // Svelte component
    let authProvider: ReturnType<typeof createAuthProvider>;
    
    export function initializeAuthProvider(options: AuthProviderProps) {
        authProvider = createAuthProvider(options);
        authProvider.initialize();
    }
    
    // Export the authProvider methods for use in other components
    export const signIn = (...args: Parameters<typeof authProvider.signIn>) => authProvider.signIn(...args);
    export const signOut = () => authProvider.signOut();
    export const fetchAccessToken = (args: Parameters<typeof authProvider.fetchAccessToken>[0]) => authProvider.fetchAccessToken(args);
    </script>
    
    <slot></slot>