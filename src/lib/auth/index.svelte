<script lang="ts">
    import { setContext, getContext } from 'svelte';
    import { writable, derived, get } from 'svelte/store';
    import { ConvexHttpClient } from "convex/browser";
    import type { ConvexReactClient } from "convex/react";
    import type { Value } from "convex/values";
    import type { AuthProvider, ConvexAuthActionsContext, ConvexAuthTokenContext, AuthState } from "./client.svelte";
    import type { AuthClient } from "./clientType";
    
    // Define the context keys
    const AUTH_ACTIONS_KEY = {};
    const AUTH_TOKEN_KEY = {};
    
    /**
     * Use this function to access the `signIn` and `signOut` methods:
     *
     * ```ts
     * import { getAuthActions } from "./ConvexAuth.svelte";
     *
     * function SomeComponent() {
     *   const { signIn, signOut } = getAuthActions();
     *   // ...
     * }
     * ```
     */
    export function getAuthActions(): ConvexAuthActionsContext {
      return getContext(AUTH_ACTIONS_KEY);
    }
    
    /**
     * Use this function to access the JWT token on the client, for authenticating
     * your Convex HTTP actions.
     *
     * You should not pass this token to other servers (think of it
     * as an "ID token").
     *
     * ```ts
     * import { getAuthToken } from "./ConvexAuth.svelte";
     *
     * function SomeComponent() {
     *   const token = getAuthToken();
     *   const onClick = async () => {
     *     await fetch(`${CONVEX_SITE_URL}/someEndpoint`, {
     *       headers: {
     *         Authorization: `Bearer ${get(token)}`,
     *       },
     *     });
     *   };
     *   // ...
     * }
     * ```
     */
    export function getAuthToken() {
      return getContext(AUTH_TOKEN_KEY);
    }
    
    export interface TokenStorage {
      getItem: (key: string) => string | undefined | null | Promise<string | undefined | null>;
      setItem: (key: string, value: string) => void | Promise<void>;
      removeItem: (key: string) => void | Promise<void>;
    }
    
    export interface ConvexAuthProviderProps {
      /**
       * Your `ConvexReactClient`.
       */
      client: ConvexReactClient;
      /**
       * Optional custom storage object that implements
       * the {@link TokenStorage} interface, otherwise
       * `localStorage` is used.
       *
       * You must set this for React Native.
       */
      storage?: TokenStorage;
      /**
       * Optional namespace for keys used to store tokens. The keys
       * determine whether the tokens are shared or not.
       *
       * Any non-alphanumeric characters will be ignored (for RN compatibility).
       *
       * Defaults to the deployment URL, as configured in the given `client`.
       */
      storageNamespace?: string;
      /**
       * Provide this function if you're using a JS router (Expo router etc.)
       * and after OAuth or magic link sign-in the `code` param is not being
       * erased from the URL.
       *
       * The implementation will depend on your chosen router.
       */
      replaceURL?: (relativeUrl: string) => void | Promise<void>;
    }
    
    // Svelte component
    export function createConvexAuthProvider(props: ConvexAuthProviderProps) {
      const { client, storage, storageNamespace, replaceURL } = props;
      
      const authClient: AuthClient = {
        authenticatedCall(action, args) {
          return client.action(action, args);
        },
        unauthenticatedCall(action, args) {
          return new ConvexHttpClient((client as any).address).action(action, args);
        },
        verbose: (client as any).options?.verbose,
      };
    
      const authProvider = createAuthProvider({
        client: authClient,
        storage: storage ?? (typeof window === "undefined" ? undefined : window?.localStorage)!,
        storageNamespace: storageNamespace ?? (client as any).address,
        replaceURL: replaceURL ?? ((url) => {
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", url);
          }
        }),
      });
    
      const authState = writable<AuthState>({
        isAuthenticated: false,
        isLoading: true,
      });
    
      const authActions: ConvexAuthActionsContext = {
        signIn: authProvider.signIn,
        signOut: authProvider.signOut,
      };
    
      const authToken = derived(authState, $state => $state.token);
    
      setContext(AUTH_ACTIONS_KEY, authActions);
      setContext(AUTH_TOKEN_KEY, authToken);
    
      return {
        authState,
        authActions,
        authToken,
      };
    }
    
    function createAuthProvider(options: {
      client: AuthClient;
      storage: TokenStorage;
      storageNamespace: string;
      replaceURL: (relativeUrl: string) => void | Promise<void>;
    }) {
      // Implement the auth provider logic here
      // This should be similar to the React version, but adapted for Svelte
      // ...
    
      return {
        signIn: async (
          provider: string,
          params?: FormData | (Record<string, Value> & { redirectTo?: string; code?: string; })
        ) => {
          // Implement signIn logic
          // ...
          return { signingIn: true };
        },
        signOut: async () => {
          // Implement signOut logic
          // ...
        },
      };
    }
    </script>
    
    <slot></slot>