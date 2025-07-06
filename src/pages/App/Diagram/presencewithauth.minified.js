(function() {
    const i = document.createElement("link").relList;
    if (i && i.supports && i.supports("modulepreload"))
        return;
    for (const h of document.querySelectorAll('link[rel="modulepreload"]'))
        r(h);
    new MutationObserver(h => {
        for (const g of h)
            if (g.type === "childList")
                for (const E of g.addedNodes)
                    E.tagName === "LINK" && E.rel === "modulepreload" && r(E)
    }
    ).observe(document, {
        childList: !0,
        subtree: !0
    });
    function s(h) {
        const g = {};
        return h.integrity && (g.integrity = h.integrity),
        h.referrerPolicy && (g.referrerPolicy = h.referrerPolicy),
        h.crossOrigin === "use-credentials" ? g.credentials = "include" : h.crossOrigin === "anonymous" ? g.credentials = "omit" : g.credentials = "same-origin",
        g
    }
    function r(h) {
        if (h.ep)
            return;
        h.ep = !0;
        const g = s(h);
        fetch(h.href, g)
    }
}
)();
function ov(c) {
    return c && c.__esModule && Object.prototype.hasOwnProperty.call(c, "default") ? c.default : c
}
var Dc = {
    exports: {}
}
  , Ha = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var $h;
function fv() {
    if ($h)
        return Ha;
    $h = 1;
    var c = Symbol.for("react.transitional.element")
      , i = Symbol.for("react.fragment");
    function s(r, h, g) {
        var E = null;
        if (g !== void 0 && (E = "" + g),
        h.key !== void 0 && (E = "" + h.key),
        "key"in h) {
            g = {};
            for (var x in h)
                x !== "key" && (g[x] = h[x])
        } else
            g = h;
        return h = g.ref,
        {
            $$typeof: c,
            type: r,
            key: E,
            ref: h !== void 0 ? h : null,
            props: g
        }
    }
    return Ha.Fragment = i,
    Ha.jsx = s,
    Ha.jsxs = s,
    Ha
}
var Wh;
function hv() {
    return Wh || (Wh = 1,
    Dc.exports = fv()),
    Dc.exports
}
var $ = hv()
  , zc = {
    exports: {}
}
  , I = {};
/**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Fh;
function dv() {
    if (Fh)
        return I;
    Fh = 1;
    var c = Symbol.for("react.transitional.element")
      , i = Symbol.for("react.portal")
      , s = Symbol.for("react.fragment")
      , r = Symbol.for("react.strict_mode")
      , h = Symbol.for("react.profiler")
      , g = Symbol.for("react.consumer")
      , E = Symbol.for("react.context")
      , x = Symbol.for("react.forward_ref")
      , T = Symbol.for("react.suspense")
      , b = Symbol.for("react.memo")
      , D = Symbol.for("react.lazy")
      , Z = Symbol.iterator;
    function z(y) {
        return y === null || typeof y != "object" ? null : (y = Z && y[Z] || y["@@iterator"],
        typeof y == "function" ? y : null)
    }
    var G = {
        isMounted: function() {
            return !1
        },
        enqueueForceUpdate: function() {},
        enqueueReplaceState: function() {},
        enqueueSetState: function() {}
    }
      , et = Object.assign
      , yt = {};
    function F(y, q, Q) {
        this.props = y,
        this.context = q,
        this.refs = yt,
        this.updater = Q || G
    }
    F.prototype.isReactComponent = {},
    F.prototype.setState = function(y, q) {
        if (typeof y != "object" && typeof y != "function" && y != null)
            throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
        this.updater.enqueueSetState(this, y, q, "setState")
    }
    ,
    F.prototype.forceUpdate = function(y) {
        this.updater.enqueueForceUpdate(this, y, "forceUpdate")
    }
    ;
    function Zt() {}
    Zt.prototype = F.prototype;
    function Qt(y, q, Q) {
        this.props = y,
        this.context = q,
        this.refs = yt,
        this.updater = Q || G
    }
    var St = Qt.prototype = new Zt;
    St.constructor = Qt,
    et(St, F.prototype),
    St.isPureReactComponent = !0;
    var pt = Array.isArray
      , X = {
        H: null,
        A: null,
        T: null,
        S: null,
        V: null
    }
      , Bt = Object.prototype.hasOwnProperty;
    function wt(y, q, Q, N, j, ut) {
        return Q = ut.ref,
        {
            $$typeof: c,
            type: y,
            key: q,
            ref: Q !== void 0 ? Q : null,
            props: ut
        }
    }
    function Tt(y, q) {
        return wt(y.type, q, void 0, void 0, void 0, y.props)
    }
    function $t(y) {
        return typeof y == "object" && y !== null && y.$$typeof === c
    }
    function je(y) {
        var q = {
            "=": "=0",
            ":": "=2"
        };
        return "$" + y.replace(/[=:]/g, function(Q) {
            return q[Q]
        })
    }
    var Wt = /\/+/g;
    function Ct(y, q) {
        return typeof y == "object" && y !== null && y.key != null ? je("" + y.key) : q.toString(36)
    }
    function Ce() {}
    function Ve(y) {
        switch (y.status) {
        case "fulfilled":
            return y.value;
        case "rejected":
            throw y.reason;
        default:
            switch (typeof y.status == "string" ? y.then(Ce, Ce) : (y.status = "pending",
            y.then(function(q) {
                y.status === "pending" && (y.status = "fulfilled",
                y.value = q)
            }, function(q) {
                y.status === "pending" && (y.status = "rejected",
                y.reason = q)
            })),
            y.status) {
            case "fulfilled":
                return y.value;
            case "rejected":
                throw y.reason
            }
        }
        throw y
    }
    function K(y, q, Q, N, j) {
        var ut = typeof y;
        (ut === "undefined" || ut === "boolean") && (y = null);
        var J = !1;
        if (y === null)
            J = !0;
        else
            switch (ut) {
            case "bigint":
            case "string":
            case "number":
                J = !0;
                break;
            case "object":
                switch (y.$$typeof) {
                case c:
                case i:
                    J = !0;
                    break;
                case D:
                    return J = y._init,
                    K(J(y._payload), q, Q, N, j)
                }
            }
        if (J)
            return j = j(y),
            J = N === "" ? "." + Ct(y, 0) : N,
            pt(j) ? (Q = "",
            J != null && (Q = J.replace(Wt, "$&/") + "/"),
            K(j, q, Q, "", function(ln) {
                return ln
            })) : j != null && ($t(j) && (j = Tt(j, Q + (j.key == null || y && y.key === j.key ? "" : ("" + j.key).replace(Wt, "$&/") + "/") + J)),
            q.push(j)),
            1;
        J = 0;
        var le = N === "" ? "." : N + ":";
        if (pt(y))
            for (var vt = 0; vt < y.length; vt++)
                N = y[vt],
                ut = le + Ct(N, vt),
                J += K(N, q, Q, ut, j);
        else if (vt = z(y),
        typeof vt == "function")
            for (y = vt.call(y),
            vt = 0; !(N = y.next()).done; )
                N = N.value,
                ut = le + Ct(N, vt++),
                J += K(N, q, Q, ut, j);
        else if (ut === "object") {
            if (typeof y.then == "function")
                return K(Ve(y), q, Q, N, j);
            throw q = String(y),
            Error("Objects are not valid as a React child (found: " + (q === "[object Object]" ? "object with keys {" + Object.keys(y).join(", ") + "}" : q) + "). If you meant to render a collection of children, use an array instead.")
        }
        return J
    }
    function _(y, q, Q) {
        if (y == null)
            return y;
        var N = []
          , j = 0;
        return K(y, N, "", "", function(ut) {
            return q.call(Q, ut, j++)
        }),
        N
    }
    function C(y) {
        if (y._status === -1) {
            var q = y._result;
            q = q(),
            q.then(function(Q) {
                (y._status === 0 || y._status === -1) && (y._status = 1,
                y._result = Q)
            }, function(Q) {
                (y._status === 0 || y._status === -1) && (y._status = 2,
                y._result = Q)
            }),
            y._status === -1 && (y._status = 0,
            y._result = q)
        }
        if (y._status === 1)
            return y._result.default;
        throw y._result
    }
    var U = typeof reportError == "function" ? reportError : function(y) {
        if (typeof window == "object" && typeof window.ErrorEvent == "function") {
            var q = new window.ErrorEvent("error",{
                bubbles: !0,
                cancelable: !0,
                message: typeof y == "object" && y !== null && typeof y.message == "string" ? String(y.message) : String(y),
                error: y
            });
            if (!window.dispatchEvent(q))
                return
        } else if (typeof process == "object" && typeof process.emit == "function") {
            process.emit("uncaughtException", y);
            return
        }
        console.error(y)
    }
    ;
    function W() {}
    return I.Children = {
        map: _,
        forEach: function(y, q, Q) {
            _(y, function() {
                q.apply(this, arguments)
            }, Q)
        },
        count: function(y) {
            var q = 0;
            return _(y, function() {
                q++
            }),
            q
        },
        toArray: function(y) {
            return _(y, function(q) {
                return q
            }) || []
        },
        only: function(y) {
            if (!$t(y))
                throw Error("React.Children.only expected to receive a single React element child.");
            return y
        }
    },
    I.Component = F,
    I.Fragment = s,
    I.Profiler = h,
    I.PureComponent = Qt,
    I.StrictMode = r,
    I.Suspense = T,
    I.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = X,
    I.__COMPILER_RUNTIME = {
        __proto__: null,
        c: function(y) {
            return X.H.useMemoCache(y)
        }
    },
    I.cache = function(y) {
        return function() {
            return y.apply(null, arguments)
        }
    }
    ,
    I.cloneElement = function(y, q, Q) {
        if (y == null)
            throw Error("The argument must be a React element, but you passed " + y + ".");
        var N = et({}, y.props)
          , j = y.key
          , ut = void 0;
        if (q != null)
            for (J in q.ref !== void 0 && (ut = void 0),
            q.key !== void 0 && (j = "" + q.key),
            q)
                !Bt.call(q, J) || J === "key" || J === "__self" || J === "__source" || J === "ref" && q.ref === void 0 || (N[J] = q[J]);
        var J = arguments.length - 2;
        if (J === 1)
            N.children = Q;
        else if (1 < J) {
            for (var le = Array(J), vt = 0; vt < J; vt++)
                le[vt] = arguments[vt + 2];
            N.children = le
        }
        return wt(y.type, j, void 0, void 0, ut, N)
    }
    ,
    I.createContext = function(y) {
        return y = {
            $$typeof: E,
            _currentValue: y,
            _currentValue2: y,
            _threadCount: 0,
            Provider: null,
            Consumer: null
        },
        y.Provider = y,
        y.Consumer = {
            $$typeof: g,
            _context: y
        },
        y
    }
    ,
    I.createElement = function(y, q, Q) {
        var N, j = {}, ut = null;
        if (q != null)
            for (N in q.key !== void 0 && (ut = "" + q.key),
            q)
                Bt.call(q, N) && N !== "key" && N !== "__self" && N !== "__source" && (j[N] = q[N]);
        var J = arguments.length - 2;
        if (J === 1)
            j.children = Q;
        else if (1 < J) {
            for (var le = Array(J), vt = 0; vt < J; vt++)
                le[vt] = arguments[vt + 2];
            j.children = le
        }
        if (y && y.defaultProps)
            for (N in J = y.defaultProps,
            J)
                j[N] === void 0 && (j[N] = J[N]);
        return wt(y, ut, void 0, void 0, null, j)
    }
    ,
    I.createRef = function() {
        return {
            current: null
        }
    }
    ,
    I.forwardRef = function(y) {
        return {
            $$typeof: x,
            render: y
        }
    }
    ,
    I.isValidElement = $t,
    I.lazy = function(y) {
        return {
            $$typeof: D,
            _payload: {
                _status: -1,
                _result: y
            },
            _init: C
        }
    }
    ,
    I.memo = function(y, q) {
        return {
            $$typeof: b,
            type: y,
            compare: q === void 0 ? null : q
        }
    }
    ,
    I.startTransition = function(y) {
        var q = X.T
          , Q = {};
        X.T = Q;
        try {
            var N = y()
              , j = X.S;
            j !== null && j(Q, N),
            typeof N == "object" && N !== null && typeof N.then == "function" && N.then(W, U)
        } catch (ut) {
            U(ut)
        } finally {
            X.T = q
        }
    }
    ,
    I.unstable_useCacheRefresh = function() {
        return X.H.useCacheRefresh()
    }
    ,
    I.use = function(y) {
        return X.H.use(y)
    }
    ,
    I.useActionState = function(y, q, Q) {
        return X.H.useActionState(y, q, Q)
    }
    ,
    I.useCallback = function(y, q) {
        return X.H.useCallback(y, q)
    }
    ,
    I.useContext = function(y) {
        return X.H.useContext(y)
    }
    ,
    I.useDebugValue = function() {}
    ,
    I.useDeferredValue = function(y, q) {
        return X.H.useDeferredValue(y, q)
    }
    ,
    I.useEffect = function(y, q, Q) {
        var N = X.H;
        if (typeof Q == "function")
            throw Error("useEffect CRUD overload is not enabled in this build of React.");
        return N.useEffect(y, q)
    }
    ,
    I.useId = function() {
        return X.H.useId()
    }
    ,
    I.useImperativeHandle = function(y, q, Q) {
        return X.H.useImperativeHandle(y, q, Q)
    }
    ,
    I.useInsertionEffect = function(y, q) {
        return X.H.useInsertionEffect(y, q)
    }
    ,
    I.useLayoutEffect = function(y, q) {
        return X.H.useLayoutEffect(y, q)
    }
    ,
    I.useMemo = function(y, q) {
        return X.H.useMemo(y, q)
    }
    ,
    I.useOptimistic = function(y, q) {
        return X.H.useOptimistic(y, q)
    }
    ,
    I.useReducer = function(y, q, Q) {
        return X.H.useReducer(y, q, Q)
    }
    ,
    I.useRef = function(y) {
        return X.H.useRef(y)
    }
    ,
    I.useState = function(y) {
        return X.H.useState(y)
    }
    ,
    I.useSyncExternalStore = function(y, q, Q) {
        return X.H.useSyncExternalStore(y, q, Q)
    }
    ,
    I.useTransition = function() {
        return X.H.useTransition()
    }
    ,
    I.version = "19.1.0",
    I
}
var Ih;
function Wc() {
    return Ih || (Ih = 1,
    zc.exports = dv()),
    zc.exports
}
var H = Wc();
const qe = ov(H);
var Uc = {
    exports: {}
}
  , La = {}
  , Nc = {
    exports: {}
}
  , Qc = {};
/**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Ph;
function yv() {
    return Ph || (Ph = 1,
    function(c) {
        function i(_, C) {
            var U = _.length;
            _.push(C);
            t: for (; 0 < U; ) {
                var W = U - 1 >>> 1
                  , y = _[W];
                if (0 < h(y, C))
                    _[W] = C,
                    _[U] = y,
                    U = W;
                else
                    break t
            }
        }
        function s(_) {
            return _.length === 0 ? null : _[0]
        }
        function r(_) {
            if (_.length === 0)
                return null;
            var C = _[0]
              , U = _.pop();
            if (U !== C) {
                _[0] = U;
                t: for (var W = 0, y = _.length, q = y >>> 1; W < q; ) {
                    var Q = 2 * (W + 1) - 1
                      , N = _[Q]
                      , j = Q + 1
                      , ut = _[j];
                    if (0 > h(N, U))
                        j < y && 0 > h(ut, N) ? (_[W] = ut,
                        _[j] = U,
                        W = j) : (_[W] = N,
                        _[Q] = U,
                        W = Q);
                    else if (j < y && 0 > h(ut, U))
                        _[W] = ut,
                        _[j] = U,
                        W = j;
                    else
                        break t
                }
            }
            return C
        }
        function h(_, C) {
            var U = _.sortIndex - C.sortIndex;
            return U !== 0 ? U : _.id - C.id
        }
        if (c.unstable_now = void 0,
        typeof performance == "object" && typeof performance.now == "function") {
            var g = performance;
            c.unstable_now = function() {
                return g.now()
            }
        } else {
            var E = Date
              , x = E.now();
            c.unstable_now = function() {
                return E.now() - x
            }
        }
        var T = []
          , b = []
          , D = 1
          , Z = null
          , z = 3
          , G = !1
          , et = !1
          , yt = !1
          , F = !1
          , Zt = typeof setTimeout == "function" ? setTimeout : null
          , Qt = typeof clearTimeout == "function" ? clearTimeout : null
          , St = typeof setImmediate < "u" ? setImmediate : null;
        function pt(_) {
            for (var C = s(b); C !== null; ) {
                if (C.callback === null)
                    r(b);
                else if (C.startTime <= _)
                    r(b),
                    C.sortIndex = C.expirationTime,
                    i(T, C);
                else
                    break;
                C = s(b)
            }
        }
        function X(_) {
            if (yt = !1,
            pt(_),
            !et)
                if (s(T) !== null)
                    et = !0,
                    Bt || (Bt = !0,
                    Ct());
                else {
                    var C = s(b);
                    C !== null && K(X, C.startTime - _)
                }
        }
        var Bt = !1
          , wt = -1
          , Tt = 5
          , $t = -1;
        function je() {
            return F ? !0 : !(c.unstable_now() - $t < Tt)
        }
        function Wt() {
            if (F = !1,
            Bt) {
                var _ = c.unstable_now();
                $t = _;
                var C = !0;
                try {
                    t: {
                        et = !1,
                        yt && (yt = !1,
                        Qt(wt),
                        wt = -1),
                        G = !0;
                        var U = z;
                        try {
                            e: {
                                for (pt(_),
                                Z = s(T); Z !== null && !(Z.expirationTime > _ && je()); ) {
                                    var W = Z.callback;
                                    if (typeof W == "function") {
                                        Z.callback = null,
                                        z = Z.priorityLevel;
                                        var y = W(Z.expirationTime <= _);
                                        if (_ = c.unstable_now(),
                                        typeof y == "function") {
                                            Z.callback = y,
                                            pt(_),
                                            C = !0;
                                            break e
                                        }
                                        Z === s(T) && r(T),
                                        pt(_)
                                    } else
                                        r(T);
                                    Z = s(T)
                                }
                                if (Z !== null)
                                    C = !0;
                                else {
                                    var q = s(b);
                                    q !== null && K(X, q.startTime - _),
                                    C = !1
                                }
                            }
                            break t
                        } finally {
                            Z = null,
                            z = U,
                            G = !1
                        }
                        C = void 0
                    }
                } finally {
                    C ? Ct() : Bt = !1
                }
            }
        }
        var Ct;
        if (typeof St == "function")
            Ct = function() {
                St(Wt)
            }
            ;
        else if (typeof MessageChannel < "u") {
            var Ce = new MessageChannel
              , Ve = Ce.port2;
            Ce.port1.onmessage = Wt,
            Ct = function() {
                Ve.postMessage(null)
            }
        } else
            Ct = function() {
                Zt(Wt, 0)
            }
            ;
        function K(_, C) {
            wt = Zt(function() {
                _(c.unstable_now())
            }, C)
        }
        c.unstable_IdlePriority = 5,
        c.unstable_ImmediatePriority = 1,
        c.unstable_LowPriority = 4,
        c.unstable_NormalPriority = 3,
        c.unstable_Profiling = null,
        c.unstable_UserBlockingPriority = 2,
        c.unstable_cancelCallback = function(_) {
            _.callback = null
        }
        ,
        c.unstable_forceFrameRate = function(_) {
            0 > _ || 125 < _ ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : Tt = 0 < _ ? Math.floor(1e3 / _) : 5
        }
        ,
        c.unstable_getCurrentPriorityLevel = function() {
            return z
        }
        ,
        c.unstable_next = function(_) {
            switch (z) {
            case 1:
            case 2:
            case 3:
                var C = 3;
                break;
            default:
                C = z
            }
            var U = z;
            z = C;
            try {
                return _()
            } finally {
                z = U
            }
        }
        ,
        c.unstable_requestPaint = function() {
            F = !0
        }
        ,
        c.unstable_runWithPriority = function(_, C) {
            switch (_) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
                break;
            default:
                _ = 3
            }
            var U = z;
            z = _;
            try {
                return C()
            } finally {
                z = U
            }
        }
        ,
        c.unstable_scheduleCallback = function(_, C, U) {
            var W = c.unstable_now();
            switch (typeof U == "object" && U !== null ? (U = U.delay,
            U = typeof U == "number" && 0 < U ? W + U : W) : U = W,
            _) {
            case 1:
                var y = -1;
                break;
            case 2:
                y = 250;
                break;
            case 5:
                y = 1073741823;
                break;
            case 4:
                y = 1e4;
                break;
            default:
                y = 5e3
            }
            return y = U + y,
            _ = {
                id: D++,
                callback: C,
                priorityLevel: _,
                startTime: U,
                expirationTime: y,
                sortIndex: -1
            },
            U > W ? (_.sortIndex = U,
            i(b, _),
            s(T) === null && _ === s(b) && (yt ? (Qt(wt),
            wt = -1) : yt = !0,
            K(X, U - W))) : (_.sortIndex = y,
            i(T, _),
            et || G || (et = !0,
            Bt || (Bt = !0,
            Ct()))),
            _
        }
        ,
        c.unstable_shouldYield = je,
        c.unstable_wrapCallback = function(_) {
            var C = z;
            return function() {
                var U = z;
                z = C;
                try {
                    return _.apply(this, arguments)
                } finally {
                    z = U
                }
            }
        }
    }(Qc)),
    Qc
}
var td;
function gv() {
    return td || (td = 1,
    Nc.exports = yv()),
    Nc.exports
}
var Bc = {
    exports: {}
}
  , Xt = {};
/**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var ed;
function vv() {
    if (ed)
        return Xt;
    ed = 1;
    var c = Wc();
    function i(T) {
        var b = "https://react.dev/errors/" + T;
        if (1 < arguments.length) {
            b += "?args[]=" + encodeURIComponent(arguments[1]);
            for (var D = 2; D < arguments.length; D++)
                b += "&args[]=" + encodeURIComponent(arguments[D])
        }
        return "Minified React error #" + T + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    }
    function s() {}
    var r = {
        d: {
            f: s,
            r: function() {
                throw Error(i(522))
            },
            D: s,
            C: s,
            L: s,
            m: s,
            X: s,
            S: s,
            M: s
        },
        p: 0,
        findDOMNode: null
    }
      , h = Symbol.for("react.portal");
    function g(T, b, D) {
        var Z = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
        return {
            $$typeof: h,
            key: Z == null ? null : "" + Z,
            children: T,
            containerInfo: b,
            implementation: D
        }
    }
    var E = c.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    function x(T, b) {
        if (T === "font")
            return "";
        if (typeof b == "string")
            return b === "use-credentials" ? b : ""
    }
    return Xt.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = r,
    Xt.createPortal = function(T, b) {
        var D = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
        if (!b || b.nodeType !== 1 && b.nodeType !== 9 && b.nodeType !== 11)
            throw Error(i(299));
        return g(T, b, null, D)
    }
    ,
    Xt.flushSync = function(T) {
        var b = E.T
          , D = r.p;
        try {
            if (E.T = null,
            r.p = 2,
            T)
                return T()
        } finally {
            E.T = b,
            r.p = D,
            r.d.f()
        }
    }
    ,
    Xt.preconnect = function(T, b) {
        typeof T == "string" && (b ? (b = b.crossOrigin,
        b = typeof b == "string" ? b === "use-credentials" ? b : "" : void 0) : b = null,
        r.d.C(T, b))
    }
    ,
    Xt.prefetchDNS = function(T) {
        typeof T == "string" && r.d.D(T)
    }
    ,
    Xt.preinit = function(T, b) {
        if (typeof T == "string" && b && typeof b.as == "string") {
            var D = b.as
              , Z = x(D, b.crossOrigin)
              , z = typeof b.integrity == "string" ? b.integrity : void 0
              , G = typeof b.fetchPriority == "string" ? b.fetchPriority : void 0;
            D === "style" ? r.d.S(T, typeof b.precedence == "string" ? b.precedence : void 0, {
                crossOrigin: Z,
                integrity: z,
                fetchPriority: G
            }) : D === "script" && r.d.X(T, {
                crossOrigin: Z,
                integrity: z,
                fetchPriority: G,
                nonce: typeof b.nonce == "string" ? b.nonce : void 0
            })
        }
    }
    ,
    Xt.preinitModule = function(T, b) {
        if (typeof T == "string")
            if (typeof b == "object" && b !== null) {
                if (b.as == null || b.as === "script") {
                    var D = x(b.as, b.crossOrigin);
                    r.d.M(T, {
                        crossOrigin: D,
                        integrity: typeof b.integrity == "string" ? b.integrity : void 0,
                        nonce: typeof b.nonce == "string" ? b.nonce : void 0
                    })
                }
            } else
                b == null && r.d.M(T)
    }
    ,
    Xt.preload = function(T, b) {
        if (typeof T == "string" && typeof b == "object" && b !== null && typeof b.as == "string") {
            var D = b.as
              , Z = x(D, b.crossOrigin);
            r.d.L(T, D, {
                crossOrigin: Z,
                integrity: typeof b.integrity == "string" ? b.integrity : void 0,
                nonce: typeof b.nonce == "string" ? b.nonce : void 0,
                type: typeof b.type == "string" ? b.type : void 0,
                fetchPriority: typeof b.fetchPriority == "string" ? b.fetchPriority : void 0,
                referrerPolicy: typeof b.referrerPolicy == "string" ? b.referrerPolicy : void 0,
                imageSrcSet: typeof b.imageSrcSet == "string" ? b.imageSrcSet : void 0,
                imageSizes: typeof b.imageSizes == "string" ? b.imageSizes : void 0,
                media: typeof b.media == "string" ? b.media : void 0
            })
        }
    }
    ,
    Xt.preloadModule = function(T, b) {
        if (typeof T == "string")
            if (b) {
                var D = x(b.as, b.crossOrigin);
                r.d.m(T, {
                    as: typeof b.as == "string" && b.as !== "script" ? b.as : void 0,
                    crossOrigin: D,
                    integrity: typeof b.integrity == "string" ? b.integrity : void 0
                })
            } else
                r.d.m(T)
    }
    ,
    Xt.requestFormReset = function(T) {
        r.d.r(T)
    }
    ,
    Xt.unstable_batchedUpdates = function(T, b) {
        return T(b)
    }
    ,
    Xt.useFormState = function(T, b, D) {
        return E.H.useFormState(T, b, D)
    }
    ,
    Xt.useFormStatus = function() {
        return E.H.useHostTransitionStatus()
    }
    ,
    Xt.version = "19.1.0",
    Xt
}
var nd;
function mv() {
    if (nd)
        return Bc.exports;
    nd = 1;
    function c() {
        if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
            try {
                __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(c)
            } catch (i) {
                console.error(i)
            }
    }
    return c(),
    Bc.exports = vv(),
    Bc.exports
}
/**
 * @license React
 * react-dom-client.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var ld;
function Sv() {
    if (ld)
        return La;
    ld = 1;
    var c = gv()
      , i = Wc()
      , s = mv();
    function r(t) {
        var e = "https://react.dev/errors/" + t;
        if (1 < arguments.length) {
            e += "?args[]=" + encodeURIComponent(arguments[1]);
            for (var n = 2; n < arguments.length; n++)
                e += "&args[]=" + encodeURIComponent(arguments[n])
        }
        return "Minified React error #" + t + "; visit " + e + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    }
    function h(t) {
        return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11)
    }
    function g(t) {
        var e = t
          , n = t;
        if (t.alternate)
            for (; e.return; )
                e = e.return;
        else {
            t = e;
            do
                e = t,
                (e.flags & 4098) !== 0 && (n = e.return),
                t = e.return;
            while (t)
        }
        return e.tag === 3 ? n : null
    }
    function E(t) {
        if (t.tag === 13) {
            var e = t.memoizedState;
            if (e === null && (t = t.alternate,
            t !== null && (e = t.memoizedState)),
            e !== null)
                return e.dehydrated
        }
        return null
    }
    function x(t) {
        if (g(t) !== t)
            throw Error(r(188))
    }
    function T(t) {
        var e = t.alternate;
        if (!e) {
            if (e = g(t),
            e === null)
                throw Error(r(188));
            return e !== t ? null : t
        }
        for (var n = t, l = e; ; ) {
            var a = n.return;
            if (a === null)
                break;
            var u = a.alternate;
            if (u === null) {
                if (l = a.return,
                l !== null) {
                    n = l;
                    continue
                }
                break
            }
            if (a.child === u.child) {
                for (u = a.child; u; ) {
                    if (u === n)
                        return x(a),
                        t;
                    if (u === l)
                        return x(a),
                        e;
                    u = u.sibling
                }
                throw Error(r(188))
            }
            if (n.return !== l.return)
                n = a,
                l = u;
            else {
                for (var o = !1, f = a.child; f; ) {
                    if (f === n) {
                        o = !0,
                        n = a,
                        l = u;
                        break
                    }
                    if (f === l) {
                        o = !0,
                        l = a,
                        n = u;
                        break
                    }
                    f = f.sibling
                }
                if (!o) {
                    for (f = u.child; f; ) {
                        if (f === n) {
                            o = !0,
                            n = u,
                            l = a;
                            break
                        }
                        if (f === l) {
                            o = !0,
                            l = u,
                            n = a;
                            break
                        }
                        f = f.sibling
                    }
                    if (!o)
                        throw Error(r(189))
                }
            }
            if (n.alternate !== l)
                throw Error(r(190))
        }
        if (n.tag !== 3)
            throw Error(r(188));
        return n.stateNode.current === n ? t : e
    }
    function b(t) {
        var e = t.tag;
        if (e === 5 || e === 26 || e === 27 || e === 6)
            return t;
        for (t = t.child; t !== null; ) {
            if (e = b(t),
            e !== null)
                return e;
            t = t.sibling
        }
        return null
    }
    var D = Object.assign
      , Z = Symbol.for("react.element")
      , z = Symbol.for("react.transitional.element")
      , G = Symbol.for("react.portal")
      , et = Symbol.for("react.fragment")
      , yt = Symbol.for("react.strict_mode")
      , F = Symbol.for("react.profiler")
      , Zt = Symbol.for("react.provider")
      , Qt = Symbol.for("react.consumer")
      , St = Symbol.for("react.context")
      , pt = Symbol.for("react.forward_ref")
      , X = Symbol.for("react.suspense")
      , Bt = Symbol.for("react.suspense_list")
      , wt = Symbol.for("react.memo")
      , Tt = Symbol.for("react.lazy")
      , $t = Symbol.for("react.activity")
      , je = Symbol.for("react.memo_cache_sentinel")
      , Wt = Symbol.iterator;
    function Ct(t) {
        return t === null || typeof t != "object" ? null : (t = Wt && t[Wt] || t["@@iterator"],
        typeof t == "function" ? t : null)
    }
    var Ce = Symbol.for("react.client.reference");
    function Ve(t) {
        if (t == null)
            return null;
        if (typeof t == "function")
            return t.$$typeof === Ce ? null : t.displayName || t.name || null;
        if (typeof t == "string")
            return t;
        switch (t) {
        case et:
            return "Fragment";
        case F:
            return "Profiler";
        case yt:
            return "StrictMode";
        case X:
            return "Suspense";
        case Bt:
            return "SuspenseList";
        case $t:
            return "Activity"
        }
        if (typeof t == "object")
            switch (t.$$typeof) {
            case G:
                return "Portal";
            case St:
                return (t.displayName || "Context") + ".Provider";
            case Qt:
                return (t._context.displayName || "Context") + ".Consumer";
            case pt:
                var e = t.render;
                return t = t.displayName,
                t || (t = e.displayName || e.name || "",
                t = t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef"),
                t;
            case wt:
                return e = t.displayName || null,
                e !== null ? e : Ve(t.type) || "Memo";
            case Tt:
                e = t._payload,
                t = t._init;
                try {
                    return Ve(t(e))
                } catch {}
            }
        return null
    }
    var K = Array.isArray
      , _ = i.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
      , C = s.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
      , U = {
        pending: !1,
        data: null,
        method: null,
        action: null
    }
      , W = []
      , y = -1;
    function q(t) {
        return {
            current: t
        }
    }
    function Q(t) {
        0 > y || (t.current = W[y],
        W[y] = null,
        y--)
    }
    function N(t, e) {
        y++,
        W[y] = t.current,
        t.current = e
    }
    var j = q(null)
      , ut = q(null)
      , J = q(null)
      , le = q(null);
    function vt(t, e) {
        switch (N(J, e),
        N(ut, t),
        N(j, null),
        e.nodeType) {
        case 9:
        case 11:
            t = (t = e.documentElement) && (t = t.namespaceURI) ? Eh(t) : 0;
            break;
        default:
            if (t = e.tagName,
            e = e.namespaceURI)
                e = Eh(e),
                t = _h(e, t);
            else
                switch (t) {
                case "svg":
                    t = 1;
                    break;
                case "math":
                    t = 2;
                    break;
                default:
                    t = 0
                }
        }
        Q(j),
        N(j, t)
    }
    function ln() {
        Q(j),
        Q(ut),
        Q(J)
    }
    function mi(t) {
        t.memoizedState !== null && N(le, t);
        var e = j.current
          , n = _h(e, t.type);
        e !== n && (N(ut, t),
        N(j, n))
    }
    function Ka(t) {
        ut.current === t && (Q(j),
        Q(ut)),
        le.current === t && (Q(le),
        za._currentValue = U)
    }
    var Si = Object.prototype.hasOwnProperty
      , bi = c.unstable_scheduleCallback
      , pi = c.unstable_cancelCallback
      , Yd = c.unstable_shouldYield
      , Gd = c.unstable_requestPaint
      , De = c.unstable_now
      , Xd = c.unstable_getCurrentPriorityLevel
      , er = c.unstable_ImmediatePriority
      , nr = c.unstable_UserBlockingPriority
      , Ja = c.unstable_NormalPriority
      , kd = c.unstable_LowPriority
      , lr = c.unstable_IdlePriority
      , Zd = c.log
      , Kd = c.unstable_setDisableYieldValue
      , Vl = null
      , ae = null;
    function an(t) {
        if (typeof Zd == "function" && Kd(t),
        ae && typeof ae.setStrictMode == "function")
            try {
                ae.setStrictMode(Vl, t)
            } catch {}
    }
    var ue = Math.clz32 ? Math.clz32 : Wd
      , Jd = Math.log
      , $d = Math.LN2;
    function Wd(t) {
        return t >>>= 0,
        t === 0 ? 32 : 31 - (Jd(t) / $d | 0) | 0
    }
    var $a = 256
      , Wa = 4194304;
    function Cn(t) {
        var e = t & 42;
        if (e !== 0)
            return e;
        switch (t & -t) {
        case 1:
            return 1;
        case 2:
            return 2;
        case 4:
            return 4;
        case 8:
            return 8;
        case 16:
            return 16;
        case 32:
            return 32;
        case 64:
            return 64;
        case 128:
            return 128;
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
            return t & 4194048;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
            return t & 62914560;
        case 67108864:
            return 67108864;
        case 134217728:
            return 134217728;
        case 268435456:
            return 268435456;
        case 536870912:
            return 536870912;
        case 1073741824:
            return 0;
        default:
            return t
        }
    }
    function Fa(t, e, n) {
        var l = t.pendingLanes;
        if (l === 0)
            return 0;
        var a = 0
          , u = t.suspendedLanes
          , o = t.pingedLanes;
        t = t.warmLanes;
        var f = l & 134217727;
        return f !== 0 ? (l = f & ~u,
        l !== 0 ? a = Cn(l) : (o &= f,
        o !== 0 ? a = Cn(o) : n || (n = f & ~t,
        n !== 0 && (a = Cn(n))))) : (f = l & ~u,
        f !== 0 ? a = Cn(f) : o !== 0 ? a = Cn(o) : n || (n = l & ~t,
        n !== 0 && (a = Cn(n)))),
        a === 0 ? 0 : e !== 0 && e !== a && (e & u) === 0 && (u = a & -a,
        n = e & -e,
        u >= n || u === 32 && (n & 4194048) !== 0) ? e : a
    }
    function Yl(t, e) {
        return (t.pendingLanes & ~(t.suspendedLanes & ~t.pingedLanes) & e) === 0
    }
    function Fd(t, e) {
        switch (t) {
        case 1:
        case 2:
        case 4:
        case 8:
        case 64:
            return e + 250;
        case 16:
        case 32:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
            return e + 5e3;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
            return -1;
        case 67108864:
        case 134217728:
        case 268435456:
        case 536870912:
        case 1073741824:
            return -1;
        default:
            return -1
        }
    }
    function ar() {
        var t = $a;
        return $a <<= 1,
        ($a & 4194048) === 0 && ($a = 256),
        t
    }
    function ur() {
        var t = Wa;
        return Wa <<= 1,
        (Wa & 62914560) === 0 && (Wa = 4194304),
        t
    }
    function Ti(t) {
        for (var e = [], n = 0; 31 > n; n++)
            e.push(t);
        return e
    }
    function Gl(t, e) {
        t.pendingLanes |= e,
        e !== 268435456 && (t.suspendedLanes = 0,
        t.pingedLanes = 0,
        t.warmLanes = 0)
    }
    function Id(t, e, n, l, a, u) {
        var o = t.pendingLanes;
        t.pendingLanes = n,
        t.suspendedLanes = 0,
        t.pingedLanes = 0,
        t.warmLanes = 0,
        t.expiredLanes &= n,
        t.entangledLanes &= n,
        t.errorRecoveryDisabledLanes &= n,
        t.shellSuspendCounter = 0;
        var f = t.entanglements
          , d = t.expirationTimes
          , p = t.hiddenUpdates;
        for (n = o & ~n; 0 < n; ) {
            var O = 31 - ue(n)
              , w = 1 << O;
            f[O] = 0,
            d[O] = -1;
            var A = p[O];
            if (A !== null)
                for (p[O] = null,
                O = 0; O < A.length; O++) {
                    var R = A[O];
                    R !== null && (R.lane &= -536870913)
                }
            n &= ~w
        }
        l !== 0 && ir(t, l, 0),
        u !== 0 && a === 0 && t.tag !== 0 && (t.suspendedLanes |= u & ~(o & ~e))
    }
    function ir(t, e, n) {
        t.pendingLanes |= e,
        t.suspendedLanes &= ~e;
        var l = 31 - ue(e);
        t.entangledLanes |= e,
        t.entanglements[l] = t.entanglements[l] | 1073741824 | n & 4194090
    }
    function sr(t, e) {
        var n = t.entangledLanes |= e;
        for (t = t.entanglements; n; ) {
            var l = 31 - ue(n)
              , a = 1 << l;
            a & e | t[l] & e && (t[l] |= e),
            n &= ~a
        }
    }
    function Ai(t) {
        switch (t) {
        case 2:
            t = 1;
            break;
        case 8:
            t = 4;
            break;
        case 32:
            t = 16;
            break;
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
            t = 128;
            break;
        case 268435456:
            t = 134217728;
            break;
        default:
            t = 0
        }
        return t
    }
    function Ei(t) {
        return t &= -t,
        2 < t ? 8 < t ? (t & 134217727) !== 0 ? 32 : 268435456 : 8 : 2
    }
    function cr() {
        var t = C.p;
        return t !== 0 ? t : (t = window.event,
        t === void 0 ? 32 : Gh(t.type))
    }
    function Pd(t, e) {
        var n = C.p;
        try {
            return C.p = t,
            e()
        } finally {
            C.p = n
        }
    }
    var un = Math.random().toString(36).slice(2)
      , Yt = "__reactFiber$" + un
      , Ft = "__reactProps$" + un
      , Pn = "__reactContainer$" + un
      , _i = "__reactEvents$" + un
      , ty = "__reactListeners$" + un
      , ey = "__reactHandles$" + un
      , rr = "__reactResources$" + un
      , Xl = "__reactMarker$" + un;
    function Ri(t) {
        delete t[Yt],
        delete t[Ft],
        delete t[_i],
        delete t[ty],
        delete t[ey]
    }
    function tl(t) {
        var e = t[Yt];
        if (e)
            return e;
        for (var n = t.parentNode; n; ) {
            if (e = n[Pn] || n[Yt]) {
                if (n = e.alternate,
                e.child !== null || n !== null && n.child !== null)
                    for (t = wh(t); t !== null; ) {
                        if (n = t[Yt])
                            return n;
                        t = wh(t)
                    }
                return e
            }
            t = n,
            n = t.parentNode
        }
        return null
    }
    function el(t) {
        if (t = t[Yt] || t[Pn]) {
            var e = t.tag;
            if (e === 5 || e === 6 || e === 13 || e === 26 || e === 27 || e === 3)
                return t
        }
        return null
    }
    function kl(t) {
        var e = t.tag;
        if (e === 5 || e === 26 || e === 27 || e === 6)
            return t.stateNode;
        throw Error(r(33))
    }
    function nl(t) {
        var e = t[rr];
        return e || (e = t[rr] = {
            hoistableStyles: new Map,
            hoistableScripts: new Map
        }),
        e
    }
    function Dt(t) {
        t[Xl] = !0
    }
    var or = new Set
      , fr = {};
    function Dn(t, e) {
        ll(t, e),
        ll(t + "Capture", e)
    }
    function ll(t, e) {
        for (fr[t] = e,
        t = 0; t < e.length; t++)
            or.add(e[t])
    }
    var ny = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$")
      , hr = {}
      , dr = {};
    function ly(t) {
        return Si.call(dr, t) ? !0 : Si.call(hr, t) ? !1 : ny.test(t) ? dr[t] = !0 : (hr[t] = !0,
        !1)
    }
    function Ia(t, e, n) {
        if (ly(e))
            if (n === null)
                t.removeAttribute(e);
            else {
                switch (typeof n) {
                case "undefined":
                case "function":
                case "symbol":
                    t.removeAttribute(e);
                    return;
                case "boolean":
                    var l = e.toLowerCase().slice(0, 5);
                    if (l !== "data-" && l !== "aria-") {
                        t.removeAttribute(e);
                        return
                    }
                }
                t.setAttribute(e, "" + n)
            }
    }
    function Pa(t, e, n) {
        if (n === null)
            t.removeAttribute(e);
        else {
            switch (typeof n) {
            case "undefined":
            case "function":
            case "symbol":
            case "boolean":
                t.removeAttribute(e);
                return
            }
            t.setAttribute(e, "" + n)
        }
    }
    function Ye(t, e, n, l) {
        if (l === null)
            t.removeAttribute(n);
        else {
            switch (typeof l) {
            case "undefined":
            case "function":
            case "symbol":
            case "boolean":
                t.removeAttribute(n);
                return
            }
            t.setAttributeNS(e, n, "" + l)
        }
    }
    var Oi, yr;
    function al(t) {
        if (Oi === void 0)
            try {
                throw Error()
            } catch (n) {
                var e = n.stack.trim().match(/\n( *(at )?)/);
                Oi = e && e[1] || "",
                yr = -1 < n.stack.indexOf(`
    at`) ? " (<anonymous>)" : -1 < n.stack.indexOf("@") ? "@unknown:0:0" : ""
            }
        return `
` + Oi + t + yr
    }
    var Mi = !1;
    function wi(t, e) {
        if (!t || Mi)
            return "";
        Mi = !0;
        var n = Error.prepareStackTrace;
        Error.prepareStackTrace = void 0;
        try {
            var l = {
                DetermineComponentFrameRoot: function() {
                    try {
                        if (e) {
                            var w = function() {
                                throw Error()
                            };
                            if (Object.defineProperty(w.prototype, "props", {
                                set: function() {
                                    throw Error()
                                }
                            }),
                            typeof Reflect == "object" && Reflect.construct) {
                                try {
                                    Reflect.construct(w, [])
                                } catch (R) {
                                    var A = R
                                }
                                Reflect.construct(t, [], w)
                            } else {
                                try {
                                    w.call()
                                } catch (R) {
                                    A = R
                                }
                                t.call(w.prototype)
                            }
                        } else {
                            try {
                                throw Error()
                            } catch (R) {
                                A = R
                            }
                            (w = t()) && typeof w.catch == "function" && w.catch(function() {})
                        }
                    } catch (R) {
                        if (R && A && typeof R.stack == "string")
                            return [R.stack, A.stack]
                    }
                    return [null, null]
                }
            };
            l.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
            var a = Object.getOwnPropertyDescriptor(l.DetermineComponentFrameRoot, "name");
            a && a.configurable && Object.defineProperty(l.DetermineComponentFrameRoot, "name", {
                value: "DetermineComponentFrameRoot"
            });
            var u = l.DetermineComponentFrameRoot()
              , o = u[0]
              , f = u[1];
            if (o && f) {
                var d = o.split(`
`)
                  , p = f.split(`
`);
                for (a = l = 0; l < d.length && !d[l].includes("DetermineComponentFrameRoot"); )
                    l++;
                for (; a < p.length && !p[a].includes("DetermineComponentFrameRoot"); )
                    a++;
                if (l === d.length || a === p.length)
                    for (l = d.length - 1,
                    a = p.length - 1; 1 <= l && 0 <= a && d[l] !== p[a]; )
                        a--;
                for (; 1 <= l && 0 <= a; l--,
                a--)
                    if (d[l] !== p[a]) {
                        if (l !== 1 || a !== 1)
                            do
                                if (l--,
                                a--,
                                0 > a || d[l] !== p[a]) {
                                    var O = `
` + d[l].replace(" at new ", " at ");
                                    return t.displayName && O.includes("<anonymous>") && (O = O.replace("<anonymous>", t.displayName)),
                                    O
                                }
                            while (1 <= l && 0 <= a);
                        break
                    }
            }
        } finally {
            Mi = !1,
            Error.prepareStackTrace = n
        }
        return (n = t ? t.displayName || t.name : "") ? al(n) : ""
    }
    function ay(t) {
        switch (t.tag) {
        case 26:
        case 27:
        case 5:
            return al(t.type);
        case 16:
            return al("Lazy");
        case 13:
            return al("Suspense");
        case 19:
            return al("SuspenseList");
        case 0:
        case 15:
            return wi(t.type, !1);
        case 11:
            return wi(t.type.render, !1);
        case 1:
            return wi(t.type, !0);
        case 31:
            return al("Activity");
        default:
            return ""
        }
    }
    function gr(t) {
        try {
            var e = "";
            do
                e += ay(t),
                t = t.return;
            while (t);
            return e
        } catch (n) {
            return `
Error generating stack: ` + n.message + `
` + n.stack
        }
    }
    function ye(t) {
        switch (typeof t) {
        case "bigint":
        case "boolean":
        case "number":
        case "string":
        case "undefined":
            return t;
        case "object":
            return t;
        default:
            return ""
        }
    }
    function vr(t) {
        var e = t.type;
        return (t = t.nodeName) && t.toLowerCase() === "input" && (e === "checkbox" || e === "radio")
    }
    function uy(t) {
        var e = vr(t) ? "checked" : "value"
          , n = Object.getOwnPropertyDescriptor(t.constructor.prototype, e)
          , l = "" + t[e];
        if (!t.hasOwnProperty(e) && typeof n < "u" && typeof n.get == "function" && typeof n.set == "function") {
            var a = n.get
              , u = n.set;
            return Object.defineProperty(t, e, {
                configurable: !0,
                get: function() {
                    return a.call(this)
                },
                set: function(o) {
                    l = "" + o,
                    u.call(this, o)
                }
            }),
            Object.defineProperty(t, e, {
                enumerable: n.enumerable
            }),
            {
                getValue: function() {
                    return l
                },
                setValue: function(o) {
                    l = "" + o
                },
                stopTracking: function() {
                    t._valueTracker = null,
                    delete t[e]
                }
            }
        }
    }
    function tu(t) {
        t._valueTracker || (t._valueTracker = uy(t))
    }
    function mr(t) {
        if (!t)
            return !1;
        var e = t._valueTracker;
        if (!e)
            return !0;
        var n = e.getValue()
          , l = "";
        return t && (l = vr(t) ? t.checked ? "true" : "false" : t.value),
        t = l,
        t !== n ? (e.setValue(t),
        !0) : !1
    }
    function eu(t) {
        if (t = t || (typeof document < "u" ? document : void 0),
        typeof t > "u")
            return null;
        try {
            return t.activeElement || t.body
        } catch {
            return t.body
        }
    }
    var iy = /[\n"\\]/g;
    function ge(t) {
        return t.replace(iy, function(e) {
            return "\\" + e.charCodeAt(0).toString(16) + " "
        })
    }
    function qi(t, e, n, l, a, u, o, f) {
        t.name = "",
        o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? t.type = o : t.removeAttribute("type"),
        e != null ? o === "number" ? (e === 0 && t.value === "" || t.value != e) && (t.value = "" + ye(e)) : t.value !== "" + ye(e) && (t.value = "" + ye(e)) : o !== "submit" && o !== "reset" || t.removeAttribute("value"),
        e != null ? xi(t, o, ye(e)) : n != null ? xi(t, o, ye(n)) : l != null && t.removeAttribute("value"),
        a == null && u != null && (t.defaultChecked = !!u),
        a != null && (t.checked = a && typeof a != "function" && typeof a != "symbol"),
        f != null && typeof f != "function" && typeof f != "symbol" && typeof f != "boolean" ? t.name = "" + ye(f) : t.removeAttribute("name")
    }
    function Sr(t, e, n, l, a, u, o, f) {
        if (u != null && typeof u != "function" && typeof u != "symbol" && typeof u != "boolean" && (t.type = u),
        e != null || n != null) {
            if (!(u !== "submit" && u !== "reset" || e != null))
                return;
            n = n != null ? "" + ye(n) : "",
            e = e != null ? "" + ye(e) : n,
            f || e === t.value || (t.value = e),
            t.defaultValue = e
        }
        l = l ?? a,
        l = typeof l != "function" && typeof l != "symbol" && !!l,
        t.checked = f ? t.checked : !!l,
        t.defaultChecked = !!l,
        o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (t.name = o)
    }
    function xi(t, e, n) {
        e === "number" && eu(t.ownerDocument) === t || t.defaultValue === "" + n || (t.defaultValue = "" + n)
    }
    function ul(t, e, n, l) {
        if (t = t.options,
        e) {
            e = {};
            for (var a = 0; a < n.length; a++)
                e["$" + n[a]] = !0;
            for (n = 0; n < t.length; n++)
                a = e.hasOwnProperty("$" + t[n].value),
                t[n].selected !== a && (t[n].selected = a),
                a && l && (t[n].defaultSelected = !0)
        } else {
            for (n = "" + ye(n),
            e = null,
            a = 0; a < t.length; a++) {
                if (t[a].value === n) {
                    t[a].selected = !0,
                    l && (t[a].defaultSelected = !0);
                    return
                }
                e !== null || t[a].disabled || (e = t[a])
            }
            e !== null && (e.selected = !0)
        }
    }
    function br(t, e, n) {
        if (e != null && (e = "" + ye(e),
        e !== t.value && (t.value = e),
        n == null)) {
            t.defaultValue !== e && (t.defaultValue = e);
            return
        }
        t.defaultValue = n != null ? "" + ye(n) : ""
    }
    function pr(t, e, n, l) {
        if (e == null) {
            if (l != null) {
                if (n != null)
                    throw Error(r(92));
                if (K(l)) {
                    if (1 < l.length)
                        throw Error(r(93));
                    l = l[0]
                }
                n = l
            }
            n == null && (n = ""),
            e = n
        }
        n = ye(e),
        t.defaultValue = n,
        l = t.textContent,
        l === n && l !== "" && l !== null && (t.value = l)
    }
    function il(t, e) {
        if (e) {
            var n = t.firstChild;
            if (n && n === t.lastChild && n.nodeType === 3) {
                n.nodeValue = e;
                return
            }
        }
        t.textContent = e
    }
    var sy = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
    function Tr(t, e, n) {
        var l = e.indexOf("--") === 0;
        n == null || typeof n == "boolean" || n === "" ? l ? t.setProperty(e, "") : e === "float" ? t.cssFloat = "" : t[e] = "" : l ? t.setProperty(e, n) : typeof n != "number" || n === 0 || sy.has(e) ? e === "float" ? t.cssFloat = n : t[e] = ("" + n).trim() : t[e] = n + "px"
    }
    function Ar(t, e, n) {
        if (e != null && typeof e != "object")
            throw Error(r(62));
        if (t = t.style,
        n != null) {
            for (var l in n)
                !n.hasOwnProperty(l) || e != null && e.hasOwnProperty(l) || (l.indexOf("--") === 0 ? t.setProperty(l, "") : l === "float" ? t.cssFloat = "" : t[l] = "");
            for (var a in e)
                l = e[a],
                e.hasOwnProperty(a) && n[a] !== l && Tr(t, a, l)
        } else
            for (var u in e)
                e.hasOwnProperty(u) && Tr(t, u, e[u])
    }
    function Ci(t) {
        if (t.indexOf("-") === -1)
            return !1;
        switch (t) {
        case "annotation-xml":
        case "color-profile":
        case "font-face":
        case "font-face-src":
        case "font-face-uri":
        case "font-face-format":
        case "font-face-name":
        case "missing-glyph":
            return !1;
        default:
            return !0
        }
    }
    var cy = new Map([["acceptCharset", "accept-charset"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"], ["crossOrigin", "crossorigin"], ["accentHeight", "accent-height"], ["alignmentBaseline", "alignment-baseline"], ["arabicForm", "arabic-form"], ["baselineShift", "baseline-shift"], ["capHeight", "cap-height"], ["clipPath", "clip-path"], ["clipRule", "clip-rule"], ["colorInterpolation", "color-interpolation"], ["colorInterpolationFilters", "color-interpolation-filters"], ["colorProfile", "color-profile"], ["colorRendering", "color-rendering"], ["dominantBaseline", "dominant-baseline"], ["enableBackground", "enable-background"], ["fillOpacity", "fill-opacity"], ["fillRule", "fill-rule"], ["floodColor", "flood-color"], ["floodOpacity", "flood-opacity"], ["fontFamily", "font-family"], ["fontSize", "font-size"], ["fontSizeAdjust", "font-size-adjust"], ["fontStretch", "font-stretch"], ["fontStyle", "font-style"], ["fontVariant", "font-variant"], ["fontWeight", "font-weight"], ["glyphName", "glyph-name"], ["glyphOrientationHorizontal", "glyph-orientation-horizontal"], ["glyphOrientationVertical", "glyph-orientation-vertical"], ["horizAdvX", "horiz-adv-x"], ["horizOriginX", "horiz-origin-x"], ["imageRendering", "image-rendering"], ["letterSpacing", "letter-spacing"], ["lightingColor", "lighting-color"], ["markerEnd", "marker-end"], ["markerMid", "marker-mid"], ["markerStart", "marker-start"], ["overlinePosition", "overline-position"], ["overlineThickness", "overline-thickness"], ["paintOrder", "paint-order"], ["panose-1", "panose-1"], ["pointerEvents", "pointer-events"], ["renderingIntent", "rendering-intent"], ["shapeRendering", "shape-rendering"], ["stopColor", "stop-color"], ["stopOpacity", "stop-opacity"], ["strikethroughPosition", "strikethrough-position"], ["strikethroughThickness", "strikethrough-thickness"], ["strokeDasharray", "stroke-dasharray"], ["strokeDashoffset", "stroke-dashoffset"], ["strokeLinecap", "stroke-linecap"], ["strokeLinejoin", "stroke-linejoin"], ["strokeMiterlimit", "stroke-miterlimit"], ["strokeOpacity", "stroke-opacity"], ["strokeWidth", "stroke-width"], ["textAnchor", "text-anchor"], ["textDecoration", "text-decoration"], ["textRendering", "text-rendering"], ["transformOrigin", "transform-origin"], ["underlinePosition", "underline-position"], ["underlineThickness", "underline-thickness"], ["unicodeBidi", "unicode-bidi"], ["unicodeRange", "unicode-range"], ["unitsPerEm", "units-per-em"], ["vAlphabetic", "v-alphabetic"], ["vHanging", "v-hanging"], ["vIdeographic", "v-ideographic"], ["vMathematical", "v-mathematical"], ["vectorEffect", "vector-effect"], ["vertAdvY", "vert-adv-y"], ["vertOriginX", "vert-origin-x"], ["vertOriginY", "vert-origin-y"], ["wordSpacing", "word-spacing"], ["writingMode", "writing-mode"], ["xmlnsXlink", "xmlns:xlink"], ["xHeight", "x-height"]])
      , ry = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
    function nu(t) {
        return ry.test("" + t) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : t
    }
    var Di = null;
    function zi(t) {
        return t = t.target || t.srcElement || window,
        t.correspondingUseElement && (t = t.correspondingUseElement),
        t.nodeType === 3 ? t.parentNode : t
    }
    var sl = null
      , cl = null;
    function Er(t) {
        var e = el(t);
        if (e && (t = e.stateNode)) {
            var n = t[Ft] || null;
            t: switch (t = e.stateNode,
            e.type) {
            case "input":
                if (qi(t, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name),
                e = n.name,
                n.type === "radio" && e != null) {
                    for (n = t; n.parentNode; )
                        n = n.parentNode;
                    for (n = n.querySelectorAll('input[name="' + ge("" + e) + '"][type="radio"]'),
                    e = 0; e < n.length; e++) {
                        var l = n[e];
                        if (l !== t && l.form === t.form) {
                            var a = l[Ft] || null;
                            if (!a)
                                throw Error(r(90));
                            qi(l, a.value, a.defaultValue, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name)
                        }
                    }
                    for (e = 0; e < n.length; e++)
                        l = n[e],
                        l.form === t.form && mr(l)
                }
                break t;
            case "textarea":
                br(t, n.value, n.defaultValue);
                break t;
            case "select":
                e = n.value,
                e != null && ul(t, !!n.multiple, e, !1)
            }
        }
    }
    var Ui = !1;
    function _r(t, e, n) {
        if (Ui)
            return t(e, n);
        Ui = !0;
        try {
            var l = t(e);
            return l
        } finally {
            if (Ui = !1,
            (sl !== null || cl !== null) && (Vu(),
            sl && (e = sl,
            t = cl,
            cl = sl = null,
            Er(e),
            t)))
                for (e = 0; e < t.length; e++)
                    Er(t[e])
        }
    }
    function Zl(t, e) {
        var n = t.stateNode;
        if (n === null)
            return null;
        var l = n[Ft] || null;
        if (l === null)
            return null;
        n = l[e];
        t: switch (e) {
        case "onClick":
        case "onClickCapture":
        case "onDoubleClick":
        case "onDoubleClickCapture":
        case "onMouseDown":
        case "onMouseDownCapture":
        case "onMouseMove":
        case "onMouseMoveCapture":
        case "onMouseUp":
        case "onMouseUpCapture":
        case "onMouseEnter":
            (l = !l.disabled) || (t = t.type,
            l = !(t === "button" || t === "input" || t === "select" || t === "textarea")),
            t = !l;
            break t;
        default:
            t = !1
        }
        if (t)
            return null;
        if (n && typeof n != "function")
            throw Error(r(231, e, typeof n));
        return n
    }
    var Ge = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u")
      , Ni = !1;
    if (Ge)
        try {
            var Kl = {};
            Object.defineProperty(Kl, "passive", {
                get: function() {
                    Ni = !0
                }
            }),
            window.addEventListener("test", Kl, Kl),
            window.removeEventListener("test", Kl, Kl)
        } catch {
            Ni = !1
        }
    var sn = null
      , Qi = null
      , lu = null;
    function Rr() {
        if (lu)
            return lu;
        var t, e = Qi, n = e.length, l, a = "value"in sn ? sn.value : sn.textContent, u = a.length;
        for (t = 0; t < n && e[t] === a[t]; t++)
            ;
        var o = n - t;
        for (l = 1; l <= o && e[n - l] === a[u - l]; l++)
            ;
        return lu = a.slice(t, 1 < l ? 1 - l : void 0)
    }
    function au(t) {
        var e = t.keyCode;
        return "charCode"in t ? (t = t.charCode,
        t === 0 && e === 13 && (t = 13)) : t = e,
        t === 10 && (t = 13),
        32 <= t || t === 13 ? t : 0
    }
    function uu() {
        return !0
    }
    function Or() {
        return !1
    }
    function It(t) {
        function e(n, l, a, u, o) {
            this._reactName = n,
            this._targetInst = a,
            this.type = l,
            this.nativeEvent = u,
            this.target = o,
            this.currentTarget = null;
            for (var f in t)
                t.hasOwnProperty(f) && (n = t[f],
                this[f] = n ? n(u) : u[f]);
            return this.isDefaultPrevented = (u.defaultPrevented != null ? u.defaultPrevented : u.returnValue === !1) ? uu : Or,
            this.isPropagationStopped = Or,
            this
        }
        return D(e.prototype, {
            preventDefault: function() {
                this.defaultPrevented = !0;
                var n = this.nativeEvent;
                n && (n.preventDefault ? n.preventDefault() : typeof n.returnValue != "unknown" && (n.returnValue = !1),
                this.isDefaultPrevented = uu)
            },
            stopPropagation: function() {
                var n = this.nativeEvent;
                n && (n.stopPropagation ? n.stopPropagation() : typeof n.cancelBubble != "unknown" && (n.cancelBubble = !0),
                this.isPropagationStopped = uu)
            },
            persist: function() {},
            isPersistent: uu
        }),
        e
    }
    var zn = {
        eventPhase: 0,
        bubbles: 0,
        cancelable: 0,
        timeStamp: function(t) {
            return t.timeStamp || Date.now()
        },
        defaultPrevented: 0,
        isTrusted: 0
    }, iu = It(zn), Jl = D({}, zn, {
        view: 0,
        detail: 0
    }), oy = It(Jl), Bi, Hi, $l, su = D({}, Jl, {
        screenX: 0,
        screenY: 0,
        clientX: 0,
        clientY: 0,
        pageX: 0,
        pageY: 0,
        ctrlKey: 0,
        shiftKey: 0,
        altKey: 0,
        metaKey: 0,
        getModifierState: ji,
        button: 0,
        buttons: 0,
        relatedTarget: function(t) {
            return t.relatedTarget === void 0 ? t.fromElement === t.srcElement ? t.toElement : t.fromElement : t.relatedTarget
        },
        movementX: function(t) {
            return "movementX"in t ? t.movementX : (t !== $l && ($l && t.type === "mousemove" ? (Bi = t.screenX - $l.screenX,
            Hi = t.screenY - $l.screenY) : Hi = Bi = 0,
            $l = t),
            Bi)
        },
        movementY: function(t) {
            return "movementY"in t ? t.movementY : Hi
        }
    }), Mr = It(su), fy = D({}, su, {
        dataTransfer: 0
    }), hy = It(fy), dy = D({}, Jl, {
        relatedTarget: 0
    }), Li = It(dy), yy = D({}, zn, {
        animationName: 0,
        elapsedTime: 0,
        pseudoElement: 0
    }), gy = It(yy), vy = D({}, zn, {
        clipboardData: function(t) {
            return "clipboardData"in t ? t.clipboardData : window.clipboardData
        }
    }), my = It(vy), Sy = D({}, zn, {
        data: 0
    }), wr = It(Sy), by = {
        Esc: "Escape",
        Spacebar: " ",
        Left: "ArrowLeft",
        Up: "ArrowUp",
        Right: "ArrowRight",
        Down: "ArrowDown",
        Del: "Delete",
        Win: "OS",
        Menu: "ContextMenu",
        Apps: "ContextMenu",
        Scroll: "ScrollLock",
        MozPrintableKey: "Unidentified"
    }, py = {
        8: "Backspace",
        9: "Tab",
        12: "Clear",
        13: "Enter",
        16: "Shift",
        17: "Control",
        18: "Alt",
        19: "Pause",
        20: "CapsLock",
        27: "Escape",
        32: " ",
        33: "PageUp",
        34: "PageDown",
        35: "End",
        36: "Home",
        37: "ArrowLeft",
        38: "ArrowUp",
        39: "ArrowRight",
        40: "ArrowDown",
        45: "Insert",
        46: "Delete",
        112: "F1",
        113: "F2",
        114: "F3",
        115: "F4",
        116: "F5",
        117: "F6",
        118: "F7",
        119: "F8",
        120: "F9",
        121: "F10",
        122: "F11",
        123: "F12",
        144: "NumLock",
        145: "ScrollLock",
        224: "Meta"
    }, Ty = {
        Alt: "altKey",
        Control: "ctrlKey",
        Meta: "metaKey",
        Shift: "shiftKey"
    };
    function Ay(t) {
        var e = this.nativeEvent;
        return e.getModifierState ? e.getModifierState(t) : (t = Ty[t]) ? !!e[t] : !1
    }
    function ji() {
        return Ay
    }
    var Ey = D({}, Jl, {
        key: function(t) {
            if (t.key) {
                var e = by[t.key] || t.key;
                if (e !== "Unidentified")
                    return e
            }
            return t.type === "keypress" ? (t = au(t),
            t === 13 ? "Enter" : String.fromCharCode(t)) : t.type === "keydown" || t.type === "keyup" ? py[t.keyCode] || "Unidentified" : ""
        },
        code: 0,
        location: 0,
        ctrlKey: 0,
        shiftKey: 0,
        altKey: 0,
        metaKey: 0,
        repeat: 0,
        locale: 0,
        getModifierState: ji,
        charCode: function(t) {
            return t.type === "keypress" ? au(t) : 0
        },
        keyCode: function(t) {
            return t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0
        },
        which: function(t) {
            return t.type === "keypress" ? au(t) : t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0
        }
    })
      , _y = It(Ey)
      , Ry = D({}, su, {
        pointerId: 0,
        width: 0,
        height: 0,
        pressure: 0,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerType: 0,
        isPrimary: 0
    })
      , qr = It(Ry)
      , Oy = D({}, Jl, {
        touches: 0,
        targetTouches: 0,
        changedTouches: 0,
        altKey: 0,
        metaKey: 0,
        ctrlKey: 0,
        shiftKey: 0,
        getModifierState: ji
    })
      , My = It(Oy)
      , wy = D({}, zn, {
        propertyName: 0,
        elapsedTime: 0,
        pseudoElement: 0
    })
      , qy = It(wy)
      , xy = D({}, su, {
        deltaX: function(t) {
            return "deltaX"in t ? t.deltaX : "wheelDeltaX"in t ? -t.wheelDeltaX : 0
        },
        deltaY: function(t) {
            return "deltaY"in t ? t.deltaY : "wheelDeltaY"in t ? -t.wheelDeltaY : "wheelDelta"in t ? -t.wheelDelta : 0
        },
        deltaZ: 0,
        deltaMode: 0
    })
      , Cy = It(xy)
      , Dy = D({}, zn, {
        newState: 0,
        oldState: 0
    })
      , zy = It(Dy)
      , Uy = [9, 13, 27, 32]
      , Vi = Ge && "CompositionEvent"in window
      , Wl = null;
    Ge && "documentMode"in document && (Wl = document.documentMode);
    var Ny = Ge && "TextEvent"in window && !Wl
      , xr = Ge && (!Vi || Wl && 8 < Wl && 11 >= Wl)
      , Cr = " "
      , Dr = !1;
    function zr(t, e) {
        switch (t) {
        case "keyup":
            return Uy.indexOf(e.keyCode) !== -1;
        case "keydown":
            return e.keyCode !== 229;
        case "keypress":
        case "mousedown":
        case "focusout":
            return !0;
        default:
            return !1
        }
    }
    function Ur(t) {
        return t = t.detail,
        typeof t == "object" && "data"in t ? t.data : null
    }
    var rl = !1;
    function Qy(t, e) {
        switch (t) {
        case "compositionend":
            return Ur(e);
        case "keypress":
            return e.which !== 32 ? null : (Dr = !0,
            Cr);
        case "textInput":
            return t = e.data,
            t === Cr && Dr ? null : t;
        default:
            return null
        }
    }
    function By(t, e) {
        if (rl)
            return t === "compositionend" || !Vi && zr(t, e) ? (t = Rr(),
            lu = Qi = sn = null,
            rl = !1,
            t) : null;
        switch (t) {
        case "paste":
            return null;
        case "keypress":
            if (!(e.ctrlKey || e.altKey || e.metaKey) || e.ctrlKey && e.altKey) {
                if (e.char && 1 < e.char.length)
                    return e.char;
                if (e.which)
                    return String.fromCharCode(e.which)
            }
            return null;
        case "compositionend":
            return xr && e.locale !== "ko" ? null : e.data;
        default:
            return null
        }
    }
    var Hy = {
        color: !0,
        date: !0,
        datetime: !0,
        "datetime-local": !0,
        email: !0,
        month: !0,
        number: !0,
        password: !0,
        range: !0,
        search: !0,
        tel: !0,
        text: !0,
        time: !0,
        url: !0,
        week: !0
    };
    function Nr(t) {
        var e = t && t.nodeName && t.nodeName.toLowerCase();
        return e === "input" ? !!Hy[t.type] : e === "textarea"
    }
    function Qr(t, e, n, l) {
        sl ? cl ? cl.push(l) : cl = [l] : sl = l,
        e = Ku(e, "onChange"),
        0 < e.length && (n = new iu("onChange","change",null,n,l),
        t.push({
            event: n,
            listeners: e
        }))
    }
    var Fl = null
      , Il = null;
    function Ly(t) {
        Sh(t, 0)
    }
    function cu(t) {
        var e = kl(t);
        if (mr(e))
            return t
    }
    function Br(t, e) {
        if (t === "change")
            return e
    }
    var Hr = !1;
    if (Ge) {
        var Yi;
        if (Ge) {
            var Gi = "oninput"in document;
            if (!Gi) {
                var Lr = document.createElement("div");
                Lr.setAttribute("oninput", "return;"),
                Gi = typeof Lr.oninput == "function"
            }
            Yi = Gi
        } else
            Yi = !1;
        Hr = Yi && (!document.documentMode || 9 < document.documentMode)
    }
    function jr() {
        Fl && (Fl.detachEvent("onpropertychange", Vr),
        Il = Fl = null)
    }
    function Vr(t) {
        if (t.propertyName === "value" && cu(Il)) {
            var e = [];
            Qr(e, Il, t, zi(t)),
            _r(Ly, e)
        }
    }
    function jy(t, e, n) {
        t === "focusin" ? (jr(),
        Fl = e,
        Il = n,
        Fl.attachEvent("onpropertychange", Vr)) : t === "focusout" && jr()
    }
    function Vy(t) {
        if (t === "selectionchange" || t === "keyup" || t === "keydown")
            return cu(Il)
    }
    function Yy(t, e) {
        if (t === "click")
            return cu(e)
    }
    function Gy(t, e) {
        if (t === "input" || t === "change")
            return cu(e)
    }
    function Xy(t, e) {
        return t === e && (t !== 0 || 1 / t === 1 / e) || t !== t && e !== e
    }
    var ie = typeof Object.is == "function" ? Object.is : Xy;
    function Pl(t, e) {
        if (ie(t, e))
            return !0;
        if (typeof t != "object" || t === null || typeof e != "object" || e === null)
            return !1;
        var n = Object.keys(t)
          , l = Object.keys(e);
        if (n.length !== l.length)
            return !1;
        for (l = 0; l < n.length; l++) {
            var a = n[l];
            if (!Si.call(e, a) || !ie(t[a], e[a]))
                return !1
        }
        return !0
    }
    function Yr(t) {
        for (; t && t.firstChild; )
            t = t.firstChild;
        return t
    }
    function Gr(t, e) {
        var n = Yr(t);
        t = 0;
        for (var l; n; ) {
            if (n.nodeType === 3) {
                if (l = t + n.textContent.length,
                t <= e && l >= e)
                    return {
                        node: n,
                        offset: e - t
                    };
                t = l
            }
            t: {
                for (; n; ) {
                    if (n.nextSibling) {
                        n = n.nextSibling;
                        break t
                    }
                    n = n.parentNode
                }
                n = void 0
            }
            n = Yr(n)
        }
    }
    function Xr(t, e) {
        return t && e ? t === e ? !0 : t && t.nodeType === 3 ? !1 : e && e.nodeType === 3 ? Xr(t, e.parentNode) : "contains"in t ? t.contains(e) : t.compareDocumentPosition ? !!(t.compareDocumentPosition(e) & 16) : !1 : !1
    }
    function kr(t) {
        t = t != null && t.ownerDocument != null && t.ownerDocument.defaultView != null ? t.ownerDocument.defaultView : window;
        for (var e = eu(t.document); e instanceof t.HTMLIFrameElement; ) {
            try {
                var n = typeof e.contentWindow.location.href == "string"
            } catch {
                n = !1
            }
            if (n)
                t = e.contentWindow;
            else
                break;
            e = eu(t.document)
        }
        return e
    }
    function Xi(t) {
        var e = t && t.nodeName && t.nodeName.toLowerCase();
        return e && (e === "input" && (t.type === "text" || t.type === "search" || t.type === "tel" || t.type === "url" || t.type === "password") || e === "textarea" || t.contentEditable === "true")
    }
    var ky = Ge && "documentMode"in document && 11 >= document.documentMode
      , ol = null
      , ki = null
      , ta = null
      , Zi = !1;
    function Zr(t, e, n) {
        var l = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
        Zi || ol == null || ol !== eu(l) || (l = ol,
        "selectionStart"in l && Xi(l) ? l = {
            start: l.selectionStart,
            end: l.selectionEnd
        } : (l = (l.ownerDocument && l.ownerDocument.defaultView || window).getSelection(),
        l = {
            anchorNode: l.anchorNode,
            anchorOffset: l.anchorOffset,
            focusNode: l.focusNode,
            focusOffset: l.focusOffset
        }),
        ta && Pl(ta, l) || (ta = l,
        l = Ku(ki, "onSelect"),
        0 < l.length && (e = new iu("onSelect","select",null,e,n),
        t.push({
            event: e,
            listeners: l
        }),
        e.target = ol)))
    }
    function Un(t, e) {
        var n = {};
        return n[t.toLowerCase()] = e.toLowerCase(),
        n["Webkit" + t] = "webkit" + e,
        n["Moz" + t] = "moz" + e,
        n
    }
    var fl = {
        animationend: Un("Animation", "AnimationEnd"),
        animationiteration: Un("Animation", "AnimationIteration"),
        animationstart: Un("Animation", "AnimationStart"),
        transitionrun: Un("Transition", "TransitionRun"),
        transitionstart: Un("Transition", "TransitionStart"),
        transitioncancel: Un("Transition", "TransitionCancel"),
        transitionend: Un("Transition", "TransitionEnd")
    }
      , Ki = {}
      , Kr = {};
    Ge && (Kr = document.createElement("div").style,
    "AnimationEvent"in window || (delete fl.animationend.animation,
    delete fl.animationiteration.animation,
    delete fl.animationstart.animation),
    "TransitionEvent"in window || delete fl.transitionend.transition);
    function Nn(t) {
        if (Ki[t])
            return Ki[t];
        if (!fl[t])
            return t;
        var e = fl[t], n;
        for (n in e)
            if (e.hasOwnProperty(n) && n in Kr)
                return Ki[t] = e[n];
        return t
    }
    var Jr = Nn("animationend")
      , $r = Nn("animationiteration")
      , Wr = Nn("animationstart")
      , Zy = Nn("transitionrun")
      , Ky = Nn("transitionstart")
      , Jy = Nn("transitioncancel")
      , Fr = Nn("transitionend")
      , Ir = new Map
      , Ji = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
    Ji.push("scrollEnd");
    function Oe(t, e) {
        Ir.set(t, e),
        Dn(e, [t])
    }
    var Pr = new WeakMap;
    function ve(t, e) {
        if (typeof t == "object" && t !== null) {
            var n = Pr.get(t);
            return n !== void 0 ? n : (e = {
                value: t,
                source: e,
                stack: gr(e)
            },
            Pr.set(t, e),
            e)
        }
        return {
            value: t,
            source: e,
            stack: gr(e)
        }
    }
    var me = []
      , hl = 0
      , $i = 0;
    function ru() {
        for (var t = hl, e = $i = hl = 0; e < t; ) {
            var n = me[e];
            me[e++] = null;
            var l = me[e];
            me[e++] = null;
            var a = me[e];
            me[e++] = null;
            var u = me[e];
            if (me[e++] = null,
            l !== null && a !== null) {
                var o = l.pending;
                o === null ? a.next = a : (a.next = o.next,
                o.next = a),
                l.pending = a
            }
            u !== 0 && to(n, a, u)
        }
    }
    function ou(t, e, n, l) {
        me[hl++] = t,
        me[hl++] = e,
        me[hl++] = n,
        me[hl++] = l,
        $i |= l,
        t.lanes |= l,
        t = t.alternate,
        t !== null && (t.lanes |= l)
    }
    function Wi(t, e, n, l) {
        return ou(t, e, n, l),
        fu(t)
    }
    function dl(t, e) {
        return ou(t, null, null, e),
        fu(t)
    }
    function to(t, e, n) {
        t.lanes |= n;
        var l = t.alternate;
        l !== null && (l.lanes |= n);
        for (var a = !1, u = t.return; u !== null; )
            u.childLanes |= n,
            l = u.alternate,
            l !== null && (l.childLanes |= n),
            u.tag === 22 && (t = u.stateNode,
            t === null || t._visibility & 1 || (a = !0)),
            t = u,
            u = u.return;
        return t.tag === 3 ? (u = t.stateNode,
        a && e !== null && (a = 31 - ue(n),
        t = u.hiddenUpdates,
        l = t[a],
        l === null ? t[a] = [e] : l.push(e),
        e.lane = n | 536870912),
        u) : null
    }
    function fu(t) {
        if (50 < Ra)
            throw Ra = 0,
            nc = null,
            Error(r(185));
        for (var e = t.return; e !== null; )
            t = e,
            e = t.return;
        return t.tag === 3 ? t.stateNode : null
    }
    var yl = {};
    function $y(t, e, n, l) {
        this.tag = t,
        this.key = n,
        this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null,
        this.index = 0,
        this.refCleanup = this.ref = null,
        this.pendingProps = e,
        this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null,
        this.mode = l,
        this.subtreeFlags = this.flags = 0,
        this.deletions = null,
        this.childLanes = this.lanes = 0,
        this.alternate = null
    }
    function se(t, e, n, l) {
        return new $y(t,e,n,l)
    }
    function Fi(t) {
        return t = t.prototype,
        !(!t || !t.isReactComponent)
    }
    function Xe(t, e) {
        var n = t.alternate;
        return n === null ? (n = se(t.tag, e, t.key, t.mode),
        n.elementType = t.elementType,
        n.type = t.type,
        n.stateNode = t.stateNode,
        n.alternate = t,
        t.alternate = n) : (n.pendingProps = e,
        n.type = t.type,
        n.flags = 0,
        n.subtreeFlags = 0,
        n.deletions = null),
        n.flags = t.flags & 65011712,
        n.childLanes = t.childLanes,
        n.lanes = t.lanes,
        n.child = t.child,
        n.memoizedProps = t.memoizedProps,
        n.memoizedState = t.memoizedState,
        n.updateQueue = t.updateQueue,
        e = t.dependencies,
        n.dependencies = e === null ? null : {
            lanes: e.lanes,
            firstContext: e.firstContext
        },
        n.sibling = t.sibling,
        n.index = t.index,
        n.ref = t.ref,
        n.refCleanup = t.refCleanup,
        n
    }
    function eo(t, e) {
        t.flags &= 65011714;
        var n = t.alternate;
        return n === null ? (t.childLanes = 0,
        t.lanes = e,
        t.child = null,
        t.subtreeFlags = 0,
        t.memoizedProps = null,
        t.memoizedState = null,
        t.updateQueue = null,
        t.dependencies = null,
        t.stateNode = null) : (t.childLanes = n.childLanes,
        t.lanes = n.lanes,
        t.child = n.child,
        t.subtreeFlags = 0,
        t.deletions = null,
        t.memoizedProps = n.memoizedProps,
        t.memoizedState = n.memoizedState,
        t.updateQueue = n.updateQueue,
        t.type = n.type,
        e = n.dependencies,
        t.dependencies = e === null ? null : {
            lanes: e.lanes,
            firstContext: e.firstContext
        }),
        t
    }
    function hu(t, e, n, l, a, u) {
        var o = 0;
        if (l = t,
        typeof t == "function")
            Fi(t) && (o = 1);
        else if (typeof t == "string")
            o = Fg(t, n, j.current) ? 26 : t === "html" || t === "head" || t === "body" ? 27 : 5;
        else
            t: switch (t) {
            case $t:
                return t = se(31, n, e, a),
                t.elementType = $t,
                t.lanes = u,
                t;
            case et:
                return Qn(n.children, a, u, e);
            case yt:
                o = 8,
                a |= 24;
                break;
            case F:
                return t = se(12, n, e, a | 2),
                t.elementType = F,
                t.lanes = u,
                t;
            case X:
                return t = se(13, n, e, a),
                t.elementType = X,
                t.lanes = u,
                t;
            case Bt:
                return t = se(19, n, e, a),
                t.elementType = Bt,
                t.lanes = u,
                t;
            default:
                if (typeof t == "object" && t !== null)
                    switch (t.$$typeof) {
                    case Zt:
                    case St:
                        o = 10;
                        break t;
                    case Qt:
                        o = 9;
                        break t;
                    case pt:
                        o = 11;
                        break t;
                    case wt:
                        o = 14;
                        break t;
                    case Tt:
                        o = 16,
                        l = null;
                        break t
                    }
                o = 29,
                n = Error(r(130, t === null ? "null" : typeof t, "")),
                l = null
            }
        return e = se(o, n, e, a),
        e.elementType = t,
        e.type = l,
        e.lanes = u,
        e
    }
    function Qn(t, e, n, l) {
        return t = se(7, t, l, e),
        t.lanes = n,
        t
    }
    function Ii(t, e, n) {
        return t = se(6, t, null, e),
        t.lanes = n,
        t
    }
    function Pi(t, e, n) {
        return e = se(4, t.children !== null ? t.children : [], t.key, e),
        e.lanes = n,
        e.stateNode = {
            containerInfo: t.containerInfo,
            pendingChildren: null,
            implementation: t.implementation
        },
        e
    }
    var gl = []
      , vl = 0
      , du = null
      , yu = 0
      , Se = []
      , be = 0
      , Bn = null
      , ke = 1
      , Ze = "";
    function Hn(t, e) {
        gl[vl++] = yu,
        gl[vl++] = du,
        du = t,
        yu = e
    }
    function no(t, e, n) {
        Se[be++] = ke,
        Se[be++] = Ze,
        Se[be++] = Bn,
        Bn = t;
        var l = ke;
        t = Ze;
        var a = 32 - ue(l) - 1;
        l &= ~(1 << a),
        n += 1;
        var u = 32 - ue(e) + a;
        if (30 < u) {
            var o = a - a % 5;
            u = (l & (1 << o) - 1).toString(32),
            l >>= o,
            a -= o,
            ke = 1 << 32 - ue(e) + a | n << a | l,
            Ze = u + t
        } else
            ke = 1 << u | n << a | l,
            Ze = t
    }
    function ts(t) {
        t.return !== null && (Hn(t, 1),
        no(t, 1, 0))
    }
    function es(t) {
        for (; t === du; )
            du = gl[--vl],
            gl[vl] = null,
            yu = gl[--vl],
            gl[vl] = null;
        for (; t === Bn; )
            Bn = Se[--be],
            Se[be] = null,
            Ze = Se[--be],
            Se[be] = null,
            ke = Se[--be],
            Se[be] = null
    }
    var Kt = null
      , At = null
      , st = !1
      , Ln = null
      , ze = !1
      , ns = Error(r(519));
    function jn(t) {
        var e = Error(r(418, ""));
        throw la(ve(e, t)),
        ns
    }
    function lo(t) {
        var e = t.stateNode
          , n = t.type
          , l = t.memoizedProps;
        switch (e[Yt] = t,
        e[Ft] = l,
        n) {
        case "dialog":
            lt("cancel", e),
            lt("close", e);
            break;
        case "iframe":
        case "object":
        case "embed":
            lt("load", e);
            break;
        case "video":
        case "audio":
            for (n = 0; n < Ma.length; n++)
                lt(Ma[n], e);
            break;
        case "source":
            lt("error", e);
            break;
        case "img":
        case "image":
        case "link":
            lt("error", e),
            lt("load", e);
            break;
        case "details":
            lt("toggle", e);
            break;
        case "input":
            lt("invalid", e),
            Sr(e, l.value, l.defaultValue, l.checked, l.defaultChecked, l.type, l.name, !0),
            tu(e);
            break;
        case "select":
            lt("invalid", e);
            break;
        case "textarea":
            lt("invalid", e),
            pr(e, l.value, l.defaultValue, l.children),
            tu(e)
        }
        n = l.children,
        typeof n != "string" && typeof n != "number" && typeof n != "bigint" || e.textContent === "" + n || l.suppressHydrationWarning === !0 || Ah(e.textContent, n) ? (l.popover != null && (lt("beforetoggle", e),
        lt("toggle", e)),
        l.onScroll != null && lt("scroll", e),
        l.onScrollEnd != null && lt("scrollend", e),
        l.onClick != null && (e.onclick = Ju),
        e = !0) : e = !1,
        e || jn(t)
    }
    function ao(t) {
        for (Kt = t.return; Kt; )
            switch (Kt.tag) {
            case 5:
            case 13:
                ze = !1;
                return;
            case 27:
            case 3:
                ze = !0;
                return;
            default:
                Kt = Kt.return
            }
    }
    function ea(t) {
        if (t !== Kt)
            return !1;
        if (!st)
            return ao(t),
            st = !0,
            !1;
        var e = t.tag, n;
        if ((n = e !== 3 && e !== 27) && ((n = e === 5) && (n = t.type,
        n = !(n !== "form" && n !== "button") || Sc(t.type, t.memoizedProps)),
        n = !n),
        n && At && jn(t),
        ao(t),
        e === 13) {
            if (t = t.memoizedState,
            t = t !== null ? t.dehydrated : null,
            !t)
                throw Error(r(317));
            t: {
                for (t = t.nextSibling,
                e = 0; t; ) {
                    if (t.nodeType === 8)
                        if (n = t.data,
                        n === "/$") {
                            if (e === 0) {
                                At = we(t.nextSibling);
                                break t
                            }
                            e--
                        } else
                            n !== "$" && n !== "$!" && n !== "$?" || e++;
                    t = t.nextSibling
                }
                At = null
            }
        } else
            e === 27 ? (e = At,
            En(t.type) ? (t = Ac,
            Ac = null,
            At = t) : At = e) : At = Kt ? we(t.stateNode.nextSibling) : null;
        return !0
    }
    function na() {
        At = Kt = null,
        st = !1
    }
    function uo() {
        var t = Ln;
        return t !== null && (ee === null ? ee = t : ee.push.apply(ee, t),
        Ln = null),
        t
    }
    function la(t) {
        Ln === null ? Ln = [t] : Ln.push(t)
    }
    var ls = q(null)
      , Vn = null
      , Ke = null;
    function cn(t, e, n) {
        N(ls, e._currentValue),
        e._currentValue = n
    }
    function Je(t) {
        t._currentValue = ls.current,
        Q(ls)
    }
    function as(t, e, n) {
        for (; t !== null; ) {
            var l = t.alternate;
            if ((t.childLanes & e) !== e ? (t.childLanes |= e,
            l !== null && (l.childLanes |= e)) : l !== null && (l.childLanes & e) !== e && (l.childLanes |= e),
            t === n)
                break;
            t = t.return
        }
    }
    function us(t, e, n, l) {
        var a = t.child;
        for (a !== null && (a.return = t); a !== null; ) {
            var u = a.dependencies;
            if (u !== null) {
                var o = a.child;
                u = u.firstContext;
                t: for (; u !== null; ) {
                    var f = u;
                    u = a;
                    for (var d = 0; d < e.length; d++)
                        if (f.context === e[d]) {
                            u.lanes |= n,
                            f = u.alternate,
                            f !== null && (f.lanes |= n),
                            as(u.return, n, t),
                            l || (o = null);
                            break t
                        }
                    u = f.next
                }
            } else if (a.tag === 18) {
                if (o = a.return,
                o === null)
                    throw Error(r(341));
                o.lanes |= n,
                u = o.alternate,
                u !== null && (u.lanes |= n),
                as(o, n, t),
                o = null
            } else
                o = a.child;
            if (o !== null)
                o.return = a;
            else
                for (o = a; o !== null; ) {
                    if (o === t) {
                        o = null;
                        break
                    }
                    if (a = o.sibling,
                    a !== null) {
                        a.return = o.return,
                        o = a;
                        break
                    }
                    o = o.return
                }
            a = o
        }
    }
    function aa(t, e, n, l) {
        t = null;
        for (var a = e, u = !1; a !== null; ) {
            if (!u) {
                if ((a.flags & 524288) !== 0)
                    u = !0;
                else if ((a.flags & 262144) !== 0)
                    break
            }
            if (a.tag === 10) {
                var o = a.alternate;
                if (o === null)
                    throw Error(r(387));
                if (o = o.memoizedProps,
                o !== null) {
                    var f = a.type;
                    ie(a.pendingProps.value, o.value) || (t !== null ? t.push(f) : t = [f])
                }
            } else if (a === le.current) {
                if (o = a.alternate,
                o === null)
                    throw Error(r(387));
                o.memoizedState.memoizedState !== a.memoizedState.memoizedState && (t !== null ? t.push(za) : t = [za])
            }
            a = a.return
        }
        t !== null && us(e, t, n, l),
        e.flags |= 262144
    }
    function gu(t) {
        for (t = t.firstContext; t !== null; ) {
            if (!ie(t.context._currentValue, t.memoizedValue))
                return !0;
            t = t.next
        }
        return !1
    }
    function Yn(t) {
        Vn = t,
        Ke = null,
        t = t.dependencies,
        t !== null && (t.firstContext = null)
    }
    function Gt(t) {
        return io(Vn, t)
    }
    function vu(t, e) {
        return Vn === null && Yn(t),
        io(t, e)
    }
    function io(t, e) {
        var n = e._currentValue;
        if (e = {
            context: e,
            memoizedValue: n,
            next: null
        },
        Ke === null) {
            if (t === null)
                throw Error(r(308));
            Ke = e,
            t.dependencies = {
                lanes: 0,
                firstContext: e
            },
            t.flags |= 524288
        } else
            Ke = Ke.next = e;
        return n
    }
    var Wy = typeof AbortController < "u" ? AbortController : function() {
        var t = []
          , e = this.signal = {
            aborted: !1,
            addEventListener: function(n, l) {
                t.push(l)
            }
        };
        this.abort = function() {
            e.aborted = !0,
            t.forEach(function(n) {
                return n()
            })
        }
    }
      , Fy = c.unstable_scheduleCallback
      , Iy = c.unstable_NormalPriority
      , qt = {
        $$typeof: St,
        Consumer: null,
        Provider: null,
        _currentValue: null,
        _currentValue2: null,
        _threadCount: 0
    };
    function is() {
        return {
            controller: new Wy,
            data: new Map,
            refCount: 0
        }
    }
    function ua(t) {
        t.refCount--,
        t.refCount === 0 && Fy(Iy, function() {
            t.controller.abort()
        })
    }
    var ia = null
      , ss = 0
      , ml = 0
      , Sl = null;
    function Py(t, e) {
        if (ia === null) {
            var n = ia = [];
            ss = 0,
            ml = rc(),
            Sl = {
                status: "pending",
                value: void 0,
                then: function(l) {
                    n.push(l)
                }
            }
        }
        return ss++,
        e.then(so, so),
        e
    }
    function so() {
        if (--ss === 0 && ia !== null) {
            Sl !== null && (Sl.status = "fulfilled");
            var t = ia;
            ia = null,
            ml = 0,
            Sl = null;
            for (var e = 0; e < t.length; e++)
                (0,
                t[e])()
        }
    }
    function tg(t, e) {
        var n = []
          , l = {
            status: "pending",
            value: null,
            reason: null,
            then: function(a) {
                n.push(a)
            }
        };
        return t.then(function() {
            l.status = "fulfilled",
            l.value = e;
            for (var a = 0; a < n.length; a++)
                (0,
                n[a])(e)
        }, function(a) {
            for (l.status = "rejected",
            l.reason = a,
            a = 0; a < n.length; a++)
                (0,
                n[a])(void 0)
        }),
        l
    }
    var co = _.S;
    _.S = function(t, e) {
        typeof e == "object" && e !== null && typeof e.then == "function" && Py(t, e),
        co !== null && co(t, e)
    }
    ;
    var Gn = q(null);
    function cs() {
        var t = Gn.current;
        return t !== null ? t : gt.pooledCache
    }
    function mu(t, e) {
        e === null ? N(Gn, Gn.current) : N(Gn, e.pool)
    }
    function ro() {
        var t = cs();
        return t === null ? null : {
            parent: qt._currentValue,
            pool: t
        }
    }
    var sa = Error(r(460))
      , oo = Error(r(474))
      , Su = Error(r(542))
      , rs = {
        then: function() {}
    };
    function fo(t) {
        return t = t.status,
        t === "fulfilled" || t === "rejected"
    }
    function bu() {}
    function ho(t, e, n) {
        switch (n = t[n],
        n === void 0 ? t.push(e) : n !== e && (e.then(bu, bu),
        e = n),
        e.status) {
        case "fulfilled":
            return e.value;
        case "rejected":
            throw t = e.reason,
            go(t),
            t;
        default:
            if (typeof e.status == "string")
                e.then(bu, bu);
            else {
                if (t = gt,
                t !== null && 100 < t.shellSuspendCounter)
                    throw Error(r(482));
                t = e,
                t.status = "pending",
                t.then(function(l) {
                    if (e.status === "pending") {
                        var a = e;
                        a.status = "fulfilled",
                        a.value = l
                    }
                }, function(l) {
                    if (e.status === "pending") {
                        var a = e;
                        a.status = "rejected",
                        a.reason = l
                    }
                })
            }
            switch (e.status) {
            case "fulfilled":
                return e.value;
            case "rejected":
                throw t = e.reason,
                go(t),
                t
            }
            throw ca = e,
            sa
        }
    }
    var ca = null;
    function yo() {
        if (ca === null)
            throw Error(r(459));
        var t = ca;
        return ca = null,
        t
    }
    function go(t) {
        if (t === sa || t === Su)
            throw Error(r(483))
    }
    var rn = !1;
    function os(t) {
        t.updateQueue = {
            baseState: t.memoizedState,
            firstBaseUpdate: null,
            lastBaseUpdate: null,
            shared: {
                pending: null,
                lanes: 0,
                hiddenCallbacks: null
            },
            callbacks: null
        }
    }
    function fs(t, e) {
        t = t.updateQueue,
        e.updateQueue === t && (e.updateQueue = {
            baseState: t.baseState,
            firstBaseUpdate: t.firstBaseUpdate,
            lastBaseUpdate: t.lastBaseUpdate,
            shared: t.shared,
            callbacks: null
        })
    }
    function on(t) {
        return {
            lane: t,
            tag: 0,
            payload: null,
            callback: null,
            next: null
        }
    }
    function fn(t, e, n) {
        var l = t.updateQueue;
        if (l === null)
            return null;
        if (l = l.shared,
        (ct & 2) !== 0) {
            var a = l.pending;
            return a === null ? e.next = e : (e.next = a.next,
            a.next = e),
            l.pending = e,
            e = fu(t),
            to(t, null, n),
            e
        }
        return ou(t, l, e, n),
        fu(t)
    }
    function ra(t, e, n) {
        if (e = e.updateQueue,
        e !== null && (e = e.shared,
        (n & 4194048) !== 0)) {
            var l = e.lanes;
            l &= t.pendingLanes,
            n |= l,
            e.lanes = n,
            sr(t, n)
        }
    }
    function hs(t, e) {
        var n = t.updateQueue
          , l = t.alternate;
        if (l !== null && (l = l.updateQueue,
        n === l)) {
            var a = null
              , u = null;
            if (n = n.firstBaseUpdate,
            n !== null) {
                do {
                    var o = {
                        lane: n.lane,
                        tag: n.tag,
                        payload: n.payload,
                        callback: null,
                        next: null
                    };
                    u === null ? a = u = o : u = u.next = o,
                    n = n.next
                } while (n !== null);
                u === null ? a = u = e : u = u.next = e
            } else
                a = u = e;
            n = {
                baseState: l.baseState,
                firstBaseUpdate: a,
                lastBaseUpdate: u,
                shared: l.shared,
                callbacks: l.callbacks
            },
            t.updateQueue = n;
            return
        }
        t = n.lastBaseUpdate,
        t === null ? n.firstBaseUpdate = e : t.next = e,
        n.lastBaseUpdate = e
    }
    var ds = !1;
    function oa() {
        if (ds) {
            var t = Sl;
            if (t !== null)
                throw t
        }
    }
    function fa(t, e, n, l) {
        ds = !1;
        var a = t.updateQueue;
        rn = !1;
        var u = a.firstBaseUpdate
          , o = a.lastBaseUpdate
          , f = a.shared.pending;
        if (f !== null) {
            a.shared.pending = null;
            var d = f
              , p = d.next;
            d.next = null,
            o === null ? u = p : o.next = p,
            o = d;
            var O = t.alternate;
            O !== null && (O = O.updateQueue,
            f = O.lastBaseUpdate,
            f !== o && (f === null ? O.firstBaseUpdate = p : f.next = p,
            O.lastBaseUpdate = d))
        }
        if (u !== null) {
            var w = a.baseState;
            o = 0,
            O = p = d = null,
            f = u;
            do {
                var A = f.lane & -536870913
                  , R = A !== f.lane;
                if (R ? (at & A) === A : (l & A) === A) {
                    A !== 0 && A === ml && (ds = !0),
                    O !== null && (O = O.next = {
                        lane: 0,
                        tag: f.tag,
                        payload: f.payload,
                        callback: null,
                        next: null
                    });
                    t: {
                        var k = t
                          , V = f;
                        A = e;
                        var ht = n;
                        switch (V.tag) {
                        case 1:
                            if (k = V.payload,
                            typeof k == "function") {
                                w = k.call(ht, w, A);
                                break t
                            }
                            w = k;
                            break t;
                        case 3:
                            k.flags = k.flags & -65537 | 128;
                        case 0:
                            if (k = V.payload,
                            A = typeof k == "function" ? k.call(ht, w, A) : k,
                            A == null)
                                break t;
                            w = D({}, w, A);
                            break t;
                        case 2:
                            rn = !0
                        }
                    }
                    A = f.callback,
                    A !== null && (t.flags |= 64,
                    R && (t.flags |= 8192),
                    R = a.callbacks,
                    R === null ? a.callbacks = [A] : R.push(A))
                } else
                    R = {
                        lane: A,
                        tag: f.tag,
                        payload: f.payload,
                        callback: f.callback,
                        next: null
                    },
                    O === null ? (p = O = R,
                    d = w) : O = O.next = R,
                    o |= A;
                if (f = f.next,
                f === null) {
                    if (f = a.shared.pending,
                    f === null)
                        break;
                    R = f,
                    f = R.next,
                    R.next = null,
                    a.lastBaseUpdate = R,
                    a.shared.pending = null
                }
            } while (!0);
            O === null && (d = w),
            a.baseState = d,
            a.firstBaseUpdate = p,
            a.lastBaseUpdate = O,
            u === null && (a.shared.lanes = 0),
            bn |= o,
            t.lanes = o,
            t.memoizedState = w
        }
    }
    function vo(t, e) {
        if (typeof t != "function")
            throw Error(r(191, t));
        t.call(e)
    }
    function mo(t, e) {
        var n = t.callbacks;
        if (n !== null)
            for (t.callbacks = null,
            t = 0; t < n.length; t++)
                vo(n[t], e)
    }
    var bl = q(null)
      , pu = q(0);
    function So(t, e) {
        t = en,
        N(pu, t),
        N(bl, e),
        en = t | e.baseLanes
    }
    function ys() {
        N(pu, en),
        N(bl, bl.current)
    }
    function gs() {
        en = pu.current,
        Q(bl),
        Q(pu)
    }
    var hn = 0
      , P = null
      , ot = null
      , Ot = null
      , Tu = !1
      , pl = !1
      , Xn = !1
      , Au = 0
      , ha = 0
      , Tl = null
      , eg = 0;
    function _t() {
        throw Error(r(321))
    }
    function vs(t, e) {
        if (e === null)
            return !1;
        for (var n = 0; n < e.length && n < t.length; n++)
            if (!ie(t[n], e[n]))
                return !1;
        return !0
    }
    function ms(t, e, n, l, a, u) {
        return hn = u,
        P = e,
        e.memoizedState = null,
        e.updateQueue = null,
        e.lanes = 0,
        _.H = t === null || t.memoizedState === null ? ef : nf,
        Xn = !1,
        u = n(l, a),
        Xn = !1,
        pl && (u = po(e, n, l, a)),
        bo(t),
        u
    }
    function bo(t) {
        _.H = wu;
        var e = ot !== null && ot.next !== null;
        if (hn = 0,
        Ot = ot = P = null,
        Tu = !1,
        ha = 0,
        Tl = null,
        e)
            throw Error(r(300));
        t === null || zt || (t = t.dependencies,
        t !== null && gu(t) && (zt = !0))
    }
    function po(t, e, n, l) {
        P = t;
        var a = 0;
        do {
            if (pl && (Tl = null),
            ha = 0,
            pl = !1,
            25 <= a)
                throw Error(r(301));
            if (a += 1,
            Ot = ot = null,
            t.updateQueue != null) {
                var u = t.updateQueue;
                u.lastEffect = null,
                u.events = null,
                u.stores = null,
                u.memoCache != null && (u.memoCache.index = 0)
            }
            _.H = cg,
            u = e(n, l)
        } while (pl);
        return u
    }
    function ng() {
        var t = _.H
          , e = t.useState()[0];
        return e = typeof e.then == "function" ? da(e) : e,
        t = t.useState()[0],
        (ot !== null ? ot.memoizedState : null) !== t && (P.flags |= 1024),
        e
    }
    function Ss() {
        var t = Au !== 0;
        return Au = 0,
        t
    }
    function bs(t, e, n) {
        e.updateQueue = t.updateQueue,
        e.flags &= -2053,
        t.lanes &= ~n
    }
    function ps(t) {
        if (Tu) {
            for (t = t.memoizedState; t !== null; ) {
                var e = t.queue;
                e !== null && (e.pending = null),
                t = t.next
            }
            Tu = !1
        }
        hn = 0,
        Ot = ot = P = null,
        pl = !1,
        ha = Au = 0,
        Tl = null
    }
    function Pt() {
        var t = {
            memoizedState: null,
            baseState: null,
            baseQueue: null,
            queue: null,
            next: null
        };
        return Ot === null ? P.memoizedState = Ot = t : Ot = Ot.next = t,
        Ot
    }
    function Mt() {
        if (ot === null) {
            var t = P.alternate;
            t = t !== null ? t.memoizedState : null
        } else
            t = ot.next;
        var e = Ot === null ? P.memoizedState : Ot.next;
        if (e !== null)
            Ot = e,
            ot = t;
        else {
            if (t === null)
                throw P.alternate === null ? Error(r(467)) : Error(r(310));
            ot = t,
            t = {
                memoizedState: ot.memoizedState,
                baseState: ot.baseState,
                baseQueue: ot.baseQueue,
                queue: ot.queue,
                next: null
            },
            Ot === null ? P.memoizedState = Ot = t : Ot = Ot.next = t
        }
        return Ot
    }
    function Ts() {
        return {
            lastEffect: null,
            events: null,
            stores: null,
            memoCache: null
        }
    }
    function da(t) {
        var e = ha;
        return ha += 1,
        Tl === null && (Tl = []),
        t = ho(Tl, t, e),
        e = P,
        (Ot === null ? e.memoizedState : Ot.next) === null && (e = e.alternate,
        _.H = e === null || e.memoizedState === null ? ef : nf),
        t
    }
    function Eu(t) {
        if (t !== null && typeof t == "object") {
            if (typeof t.then == "function")
                return da(t);
            if (t.$$typeof === St)
                return Gt(t)
        }
        throw Error(r(438, String(t)))
    }
    function As(t) {
        var e = null
          , n = P.updateQueue;
        if (n !== null && (e = n.memoCache),
        e == null) {
            var l = P.alternate;
            l !== null && (l = l.updateQueue,
            l !== null && (l = l.memoCache,
            l != null && (e = {
                data: l.data.map(function(a) {
                    return a.slice()
                }),
                index: 0
            })))
        }
        if (e == null && (e = {
            data: [],
            index: 0
        }),
        n === null && (n = Ts(),
        P.updateQueue = n),
        n.memoCache = e,
        n = e.data[e.index],
        n === void 0)
            for (n = e.data[e.index] = Array(t),
            l = 0; l < t; l++)
                n[l] = je;
        return e.index++,
        n
    }
    function $e(t, e) {
        return typeof e == "function" ? e(t) : e
    }
    function _u(t) {
        var e = Mt();
        return Es(e, ot, t)
    }
    function Es(t, e, n) {
        var l = t.queue;
        if (l === null)
            throw Error(r(311));
        l.lastRenderedReducer = n;
        var a = t.baseQueue
          , u = l.pending;
        if (u !== null) {
            if (a !== null) {
                var o = a.next;
                a.next = u.next,
                u.next = o
            }
            e.baseQueue = a = u,
            l.pending = null
        }
        if (u = t.baseState,
        a === null)
            t.memoizedState = u;
        else {
            e = a.next;
            var f = o = null
              , d = null
              , p = e
              , O = !1;
            do {
                var w = p.lane & -536870913;
                if (w !== p.lane ? (at & w) === w : (hn & w) === w) {
                    var A = p.revertLane;
                    if (A === 0)
                        d !== null && (d = d.next = {
                            lane: 0,
                            revertLane: 0,
                            action: p.action,
                            hasEagerState: p.hasEagerState,
                            eagerState: p.eagerState,
                            next: null
                        }),
                        w === ml && (O = !0);
                    else if ((hn & A) === A) {
                        p = p.next,
                        A === ml && (O = !0);
                        continue
                    } else
                        w = {
                            lane: 0,
                            revertLane: p.revertLane,
                            action: p.action,
                            hasEagerState: p.hasEagerState,
                            eagerState: p.eagerState,
                            next: null
                        },
                        d === null ? (f = d = w,
                        o = u) : d = d.next = w,
                        P.lanes |= A,
                        bn |= A;
                    w = p.action,
                    Xn && n(u, w),
                    u = p.hasEagerState ? p.eagerState : n(u, w)
                } else
                    A = {
                        lane: w,
                        revertLane: p.revertLane,
                        action: p.action,
                        hasEagerState: p.hasEagerState,
                        eagerState: p.eagerState,
                        next: null
                    },
                    d === null ? (f = d = A,
                    o = u) : d = d.next = A,
                    P.lanes |= w,
                    bn |= w;
                p = p.next
            } while (p !== null && p !== e);
            if (d === null ? o = u : d.next = f,
            !ie(u, t.memoizedState) && (zt = !0,
            O && (n = Sl,
            n !== null)))
                throw n;
            t.memoizedState = u,
            t.baseState = o,
            t.baseQueue = d,
            l.lastRenderedState = u
        }
        return a === null && (l.lanes = 0),
        [t.memoizedState, l.dispatch]
    }
    function _s(t) {
        var e = Mt()
          , n = e.queue;
        if (n === null)
            throw Error(r(311));
        n.lastRenderedReducer = t;
        var l = n.dispatch
          , a = n.pending
          , u = e.memoizedState;
        if (a !== null) {
            n.pending = null;
            var o = a = a.next;
            do
                u = t(u, o.action),
                o = o.next;
            while (o !== a);
            ie(u, e.memoizedState) || (zt = !0),
            e.memoizedState = u,
            e.baseQueue === null && (e.baseState = u),
            n.lastRenderedState = u
        }
        return [u, l]
    }
    function To(t, e, n) {
        var l = P
          , a = Mt()
          , u = st;
        if (u) {
            if (n === void 0)
                throw Error(r(407));
            n = n()
        } else
            n = e();
        var o = !ie((ot || a).memoizedState, n);
        o && (a.memoizedState = n,
        zt = !0),
        a = a.queue;
        var f = _o.bind(null, l, a, t);
        if (ya(2048, 8, f, [t]),
        a.getSnapshot !== e || o || Ot !== null && Ot.memoizedState.tag & 1) {
            if (l.flags |= 2048,
            Al(9, Ru(), Eo.bind(null, l, a, n, e), null),
            gt === null)
                throw Error(r(349));
            u || (hn & 124) !== 0 || Ao(l, e, n)
        }
        return n
    }
    function Ao(t, e, n) {
        t.flags |= 16384,
        t = {
            getSnapshot: e,
            value: n
        },
        e = P.updateQueue,
        e === null ? (e = Ts(),
        P.updateQueue = e,
        e.stores = [t]) : (n = e.stores,
        n === null ? e.stores = [t] : n.push(t))
    }
    function Eo(t, e, n, l) {
        e.value = n,
        e.getSnapshot = l,
        Ro(e) && Oo(t)
    }
    function _o(t, e, n) {
        return n(function() {
            Ro(e) && Oo(t)
        })
    }
    function Ro(t) {
        var e = t.getSnapshot;
        t = t.value;
        try {
            var n = e();
            return !ie(t, n)
        } catch {
            return !0
        }
    }
    function Oo(t) {
        var e = dl(t, 2);
        e !== null && he(e, t, 2)
    }
    function Rs(t) {
        var e = Pt();
        if (typeof t == "function") {
            var n = t;
            if (t = n(),
            Xn) {
                an(!0);
                try {
                    n()
                } finally {
                    an(!1)
                }
            }
        }
        return e.memoizedState = e.baseState = t,
        e.queue = {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: $e,
            lastRenderedState: t
        },
        e
    }
    function Mo(t, e, n, l) {
        return t.baseState = n,
        Es(t, ot, typeof l == "function" ? l : $e)
    }
    function lg(t, e, n, l, a) {
        if (Mu(t))
            throw Error(r(485));
        if (t = e.action,
        t !== null) {
            var u = {
                payload: a,
                action: t,
                next: null,
                isTransition: !0,
                status: "pending",
                value: null,
                reason: null,
                listeners: [],
                then: function(o) {
                    u.listeners.push(o)
                }
            };
            _.T !== null ? n(!0) : u.isTransition = !1,
            l(u),
            n = e.pending,
            n === null ? (u.next = e.pending = u,
            wo(e, u)) : (u.next = n.next,
            e.pending = n.next = u)
        }
    }
    function wo(t, e) {
        var n = e.action
          , l = e.payload
          , a = t.state;
        if (e.isTransition) {
            var u = _.T
              , o = {};
            _.T = o;
            try {
                var f = n(a, l)
                  , d = _.S;
                d !== null && d(o, f),
                qo(t, e, f)
            } catch (p) {
                Os(t, e, p)
            } finally {
                _.T = u
            }
        } else
            try {
                u = n(a, l),
                qo(t, e, u)
            } catch (p) {
                Os(t, e, p)
            }
    }
    function qo(t, e, n) {
        n !== null && typeof n == "object" && typeof n.then == "function" ? n.then(function(l) {
            xo(t, e, l)
        }, function(l) {
            return Os(t, e, l)
        }) : xo(t, e, n)
    }
    function xo(t, e, n) {
        e.status = "fulfilled",
        e.value = n,
        Co(e),
        t.state = n,
        e = t.pending,
        e !== null && (n = e.next,
        n === e ? t.pending = null : (n = n.next,
        e.next = n,
        wo(t, n)))
    }
    function Os(t, e, n) {
        var l = t.pending;
        if (t.pending = null,
        l !== null) {
            l = l.next;
            do
                e.status = "rejected",
                e.reason = n,
                Co(e),
                e = e.next;
            while (e !== l)
        }
        t.action = null
    }
    function Co(t) {
        t = t.listeners;
        for (var e = 0; e < t.length; e++)
            (0,
            t[e])()
    }
    function Do(t, e) {
        return e
    }
    function zo(t, e) {
        if (st) {
            var n = gt.formState;
            if (n !== null) {
                t: {
                    var l = P;
                    if (st) {
                        if (At) {
                            e: {
                                for (var a = At, u = ze; a.nodeType !== 8; ) {
                                    if (!u) {
                                        a = null;
                                        break e
                                    }
                                    if (a = we(a.nextSibling),
                                    a === null) {
                                        a = null;
                                        break e
                                    }
                                }
                                u = a.data,
                                a = u === "F!" || u === "F" ? a : null
                            }
                            if (a) {
                                At = we(a.nextSibling),
                                l = a.data === "F!";
                                break t
                            }
                        }
                        jn(l)
                    }
                    l = !1
                }
                l && (e = n[0])
            }
        }
        return n = Pt(),
        n.memoizedState = n.baseState = e,
        l = {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: Do,
            lastRenderedState: e
        },
        n.queue = l,
        n = Io.bind(null, P, l),
        l.dispatch = n,
        l = Rs(!1),
        u = Cs.bind(null, P, !1, l.queue),
        l = Pt(),
        a = {
            state: e,
            dispatch: null,
            action: t,
            pending: null
        },
        l.queue = a,
        n = lg.bind(null, P, a, u, n),
        a.dispatch = n,
        l.memoizedState = t,
        [e, n, !1]
    }
    function Uo(t) {
        var e = Mt();
        return No(e, ot, t)
    }
    function No(t, e, n) {
        if (e = Es(t, e, Do)[0],
        t = _u($e)[0],
        typeof e == "object" && e !== null && typeof e.then == "function")
            try {
                var l = da(e)
            } catch (o) {
                throw o === sa ? Su : o
            }
        else
            l = e;
        e = Mt();
        var a = e.queue
          , u = a.dispatch;
        return n !== e.memoizedState && (P.flags |= 2048,
        Al(9, Ru(), ag.bind(null, a, n), null)),
        [l, u, t]
    }
    function ag(t, e) {
        t.action = e
    }
    function Qo(t) {
        var e = Mt()
          , n = ot;
        if (n !== null)
            return No(e, n, t);
        Mt(),
        e = e.memoizedState,
        n = Mt();
        var l = n.queue.dispatch;
        return n.memoizedState = t,
        [e, l, !1]
    }
    function Al(t, e, n, l) {
        return t = {
            tag: t,
            create: n,
            deps: l,
            inst: e,
            next: null
        },
        e = P.updateQueue,
        e === null && (e = Ts(),
        P.updateQueue = e),
        n = e.lastEffect,
        n === null ? e.lastEffect = t.next = t : (l = n.next,
        n.next = t,
        t.next = l,
        e.lastEffect = t),
        t
    }
    function Ru() {
        return {
            destroy: void 0,
            resource: void 0
        }
    }
    function Bo() {
        return Mt().memoizedState
    }
    function Ou(t, e, n, l) {
        var a = Pt();
        l = l === void 0 ? null : l,
        P.flags |= t,
        a.memoizedState = Al(1 | e, Ru(), n, l)
    }
    function ya(t, e, n, l) {
        var a = Mt();
        l = l === void 0 ? null : l;
        var u = a.memoizedState.inst;
        ot !== null && l !== null && vs(l, ot.memoizedState.deps) ? a.memoizedState = Al(e, u, n, l) : (P.flags |= t,
        a.memoizedState = Al(1 | e, u, n, l))
    }
    function Ho(t, e) {
        Ou(8390656, 8, t, e)
    }
    function Lo(t, e) {
        ya(2048, 8, t, e)
    }
    function jo(t, e) {
        return ya(4, 2, t, e)
    }
    function Vo(t, e) {
        return ya(4, 4, t, e)
    }
    function Yo(t, e) {
        if (typeof e == "function") {
            t = t();
            var n = e(t);
            return function() {
                typeof n == "function" ? n() : e(null)
            }
        }
        if (e != null)
            return t = t(),
            e.current = t,
            function() {
                e.current = null
            }
    }
    function Go(t, e, n) {
        n = n != null ? n.concat([t]) : null,
        ya(4, 4, Yo.bind(null, e, t), n)
    }
    function Ms() {}
    function Xo(t, e) {
        var n = Mt();
        e = e === void 0 ? null : e;
        var l = n.memoizedState;
        return e !== null && vs(e, l[1]) ? l[0] : (n.memoizedState = [t, e],
        t)
    }
    function ko(t, e) {
        var n = Mt();
        e = e === void 0 ? null : e;
        var l = n.memoizedState;
        if (e !== null && vs(e, l[1]))
            return l[0];
        if (l = t(),
        Xn) {
            an(!0);
            try {
                t()
            } finally {
                an(!1)
            }
        }
        return n.memoizedState = [l, e],
        l
    }
    function ws(t, e, n) {
        return n === void 0 || (hn & 1073741824) !== 0 ? t.memoizedState = e : (t.memoizedState = n,
        t = $f(),
        P.lanes |= t,
        bn |= t,
        n)
    }
    function Zo(t, e, n, l) {
        return ie(n, e) ? n : bl.current !== null ? (t = ws(t, n, l),
        ie(t, e) || (zt = !0),
        t) : (hn & 42) === 0 ? (zt = !0,
        t.memoizedState = n) : (t = $f(),
        P.lanes |= t,
        bn |= t,
        e)
    }
    function Ko(t, e, n, l, a) {
        var u = C.p;
        C.p = u !== 0 && 8 > u ? u : 8;
        var o = _.T
          , f = {};
        _.T = f,
        Cs(t, !1, e, n);
        try {
            var d = a()
              , p = _.S;
            if (p !== null && p(f, d),
            d !== null && typeof d == "object" && typeof d.then == "function") {
                var O = tg(d, l);
                ga(t, e, O, fe(t))
            } else
                ga(t, e, l, fe(t))
        } catch (w) {
            ga(t, e, {
                then: function() {},
                status: "rejected",
                reason: w
            }, fe())
        } finally {
            C.p = u,
            _.T = o
        }
    }
    function ug() {}
    function qs(t, e, n, l) {
        if (t.tag !== 5)
            throw Error(r(476));
        var a = Jo(t).queue;
        Ko(t, a, e, U, n === null ? ug : function() {
            return $o(t),
            n(l)
        }
        )
    }
    function Jo(t) {
        var e = t.memoizedState;
        if (e !== null)
            return e;
        e = {
            memoizedState: U,
            baseState: U,
            baseQueue: null,
            queue: {
                pending: null,
                lanes: 0,
                dispatch: null,
                lastRenderedReducer: $e,
                lastRenderedState: U
            },
            next: null
        };
        var n = {};
        return e.next = {
            memoizedState: n,
            baseState: n,
            baseQueue: null,
            queue: {
                pending: null,
                lanes: 0,
                dispatch: null,
                lastRenderedReducer: $e,
                lastRenderedState: n
            },
            next: null
        },
        t.memoizedState = e,
        t = t.alternate,
        t !== null && (t.memoizedState = e),
        e
    }
    function $o(t) {
        var e = Jo(t).next.queue;
        ga(t, e, {}, fe())
    }
    function xs() {
        return Gt(za)
    }
    function Wo() {
        return Mt().memoizedState
    }
    function Fo() {
        return Mt().memoizedState
    }
    function ig(t) {
        for (var e = t.return; e !== null; ) {
            switch (e.tag) {
            case 24:
            case 3:
                var n = fe();
                t = on(n);
                var l = fn(e, t, n);
                l !== null && (he(l, e, n),
                ra(l, e, n)),
                e = {
                    cache: is()
                },
                t.payload = e;
                return
            }
            e = e.return
        }
    }
    function sg(t, e, n) {
        var l = fe();
        n = {
            lane: l,
            revertLane: 0,
            action: n,
            hasEagerState: !1,
            eagerState: null,
            next: null
        },
        Mu(t) ? Po(e, n) : (n = Wi(t, e, n, l),
        n !== null && (he(n, t, l),
        tf(n, e, l)))
    }
    function Io(t, e, n) {
        var l = fe();
        ga(t, e, n, l)
    }
    function ga(t, e, n, l) {
        var a = {
            lane: l,
            revertLane: 0,
            action: n,
            hasEagerState: !1,
            eagerState: null,
            next: null
        };
        if (Mu(t))
            Po(e, a);
        else {
            var u = t.alternate;
            if (t.lanes === 0 && (u === null || u.lanes === 0) && (u = e.lastRenderedReducer,
            u !== null))
                try {
                    var o = e.lastRenderedState
                      , f = u(o, n);
                    if (a.hasEagerState = !0,
                    a.eagerState = f,
                    ie(f, o))
                        return ou(t, e, a, 0),
                        gt === null && ru(),
                        !1
                } catch {} finally {}
            if (n = Wi(t, e, a, l),
            n !== null)
                return he(n, t, l),
                tf(n, e, l),
                !0
        }
        return !1
    }
    function Cs(t, e, n, l) {
        if (l = {
            lane: 2,
            revertLane: rc(),
            action: l,
            hasEagerState: !1,
            eagerState: null,
            next: null
        },
        Mu(t)) {
            if (e)
                throw Error(r(479))
        } else
            e = Wi(t, n, l, 2),
            e !== null && he(e, t, 2)
    }
    function Mu(t) {
        var e = t.alternate;
        return t === P || e !== null && e === P
    }
    function Po(t, e) {
        pl = Tu = !0;
        var n = t.pending;
        n === null ? e.next = e : (e.next = n.next,
        n.next = e),
        t.pending = e
    }
    function tf(t, e, n) {
        if ((n & 4194048) !== 0) {
            var l = e.lanes;
            l &= t.pendingLanes,
            n |= l,
            e.lanes = n,
            sr(t, n)
        }
    }
    var wu = {
        readContext: Gt,
        use: Eu,
        useCallback: _t,
        useContext: _t,
        useEffect: _t,
        useImperativeHandle: _t,
        useLayoutEffect: _t,
        useInsertionEffect: _t,
        useMemo: _t,
        useReducer: _t,
        useRef: _t,
        useState: _t,
        useDebugValue: _t,
        useDeferredValue: _t,
        useTransition: _t,
        useSyncExternalStore: _t,
        useId: _t,
        useHostTransitionStatus: _t,
        useFormState: _t,
        useActionState: _t,
        useOptimistic: _t,
        useMemoCache: _t,
        useCacheRefresh: _t
    }
      , ef = {
        readContext: Gt,
        use: Eu,
        useCallback: function(t, e) {
            return Pt().memoizedState = [t, e === void 0 ? null : e],
            t
        },
        useContext: Gt,
        useEffect: Ho,
        useImperativeHandle: function(t, e, n) {
            n = n != null ? n.concat([t]) : null,
            Ou(4194308, 4, Yo.bind(null, e, t), n)
        },
        useLayoutEffect: function(t, e) {
            return Ou(4194308, 4, t, e)
        },
        useInsertionEffect: function(t, e) {
            Ou(4, 2, t, e)
        },
        useMemo: function(t, e) {
            var n = Pt();
            e = e === void 0 ? null : e;
            var l = t();
            if (Xn) {
                an(!0);
                try {
                    t()
                } finally {
                    an(!1)
                }
            }
            return n.memoizedState = [l, e],
            l
        },
        useReducer: function(t, e, n) {
            var l = Pt();
            if (n !== void 0) {
                var a = n(e);
                if (Xn) {
                    an(!0);
                    try {
                        n(e)
                    } finally {
                        an(!1)
                    }
                }
            } else
                a = e;
            return l.memoizedState = l.baseState = a,
            t = {
                pending: null,
                lanes: 0,
                dispatch: null,
                lastRenderedReducer: t,
                lastRenderedState: a
            },
            l.queue = t,
            t = t.dispatch = sg.bind(null, P, t),
            [l.memoizedState, t]
        },
        useRef: function(t) {
            var e = Pt();
            return t = {
                current: t
            },
            e.memoizedState = t
        },
        useState: function(t) {
            t = Rs(t);
            var e = t.queue
              , n = Io.bind(null, P, e);
            return e.dispatch = n,
            [t.memoizedState, n]
        },
        useDebugValue: Ms,
        useDeferredValue: function(t, e) {
            var n = Pt();
            return ws(n, t, e)
        },
        useTransition: function() {
            var t = Rs(!1);
            return t = Ko.bind(null, P, t.queue, !0, !1),
            Pt().memoizedState = t,
            [!1, t]
        },
        useSyncExternalStore: function(t, e, n) {
            var l = P
              , a = Pt();
            if (st) {
                if (n === void 0)
                    throw Error(r(407));
                n = n()
            } else {
                if (n = e(),
                gt === null)
                    throw Error(r(349));
                (at & 124) !== 0 || Ao(l, e, n)
            }
            a.memoizedState = n;
            var u = {
                value: n,
                getSnapshot: e
            };
            return a.queue = u,
            Ho(_o.bind(null, l, u, t), [t]),
            l.flags |= 2048,
            Al(9, Ru(), Eo.bind(null, l, u, n, e), null),
            n
        },
        useId: function() {
            var t = Pt()
              , e = gt.identifierPrefix;
            if (st) {
                var n = Ze
                  , l = ke;
                n = (l & ~(1 << 32 - ue(l) - 1)).toString(32) + n,
                e = "«" + e + "R" + n,
                n = Au++,
                0 < n && (e += "H" + n.toString(32)),
                e += "»"
            } else
                n = eg++,
                e = "«" + e + "r" + n.toString(32) + "»";
            return t.memoizedState = e
        },
        useHostTransitionStatus: xs,
        useFormState: zo,
        useActionState: zo,
        useOptimistic: function(t) {
            var e = Pt();
            e.memoizedState = e.baseState = t;
            var n = {
                pending: null,
                lanes: 0,
                dispatch: null,
                lastRenderedReducer: null,
                lastRenderedState: null
            };
            return e.queue = n,
            e = Cs.bind(null, P, !0, n),
            n.dispatch = e,
            [t, e]
        },
        useMemoCache: As,
        useCacheRefresh: function() {
            return Pt().memoizedState = ig.bind(null, P)
        }
    }
      , nf = {
        readContext: Gt,
        use: Eu,
        useCallback: Xo,
        useContext: Gt,
        useEffect: Lo,
        useImperativeHandle: Go,
        useInsertionEffect: jo,
        useLayoutEffect: Vo,
        useMemo: ko,
        useReducer: _u,
        useRef: Bo,
        useState: function() {
            return _u($e)
        },
        useDebugValue: Ms,
        useDeferredValue: function(t, e) {
            var n = Mt();
            return Zo(n, ot.memoizedState, t, e)
        },
        useTransition: function() {
            var t = _u($e)[0]
              , e = Mt().memoizedState;
            return [typeof t == "boolean" ? t : da(t), e]
        },
        useSyncExternalStore: To,
        useId: Wo,
        useHostTransitionStatus: xs,
        useFormState: Uo,
        useActionState: Uo,
        useOptimistic: function(t, e) {
            var n = Mt();
            return Mo(n, ot, t, e)
        },
        useMemoCache: As,
        useCacheRefresh: Fo
    }
      , cg = {
        readContext: Gt,
        use: Eu,
        useCallback: Xo,
        useContext: Gt,
        useEffect: Lo,
        useImperativeHandle: Go,
        useInsertionEffect: jo,
        useLayoutEffect: Vo,
        useMemo: ko,
        useReducer: _s,
        useRef: Bo,
        useState: function() {
            return _s($e)
        },
        useDebugValue: Ms,
        useDeferredValue: function(t, e) {
            var n = Mt();
            return ot === null ? ws(n, t, e) : Zo(n, ot.memoizedState, t, e)
        },
        useTransition: function() {
            var t = _s($e)[0]
              , e = Mt().memoizedState;
            return [typeof t == "boolean" ? t : da(t), e]
        },
        useSyncExternalStore: To,
        useId: Wo,
        useHostTransitionStatus: xs,
        useFormState: Qo,
        useActionState: Qo,
        useOptimistic: function(t, e) {
            var n = Mt();
            return ot !== null ? Mo(n, ot, t, e) : (n.baseState = t,
            [t, n.queue.dispatch])
        },
        useMemoCache: As,
        useCacheRefresh: Fo
    }
      , El = null
      , va = 0;
    function qu(t) {
        var e = va;
        return va += 1,
        El === null && (El = []),
        ho(El, t, e)
    }
    function ma(t, e) {
        e = e.props.ref,
        t.ref = e !== void 0 ? e : null
    }
    function xu(t, e) {
        throw e.$$typeof === Z ? Error(r(525)) : (t = Object.prototype.toString.call(e),
        Error(r(31, t === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : t)))
    }
    function lf(t) {
        var e = t._init;
        return e(t._payload)
    }
    function af(t) {
        function e(m, v) {
            if (t) {
                var S = m.deletions;
                S === null ? (m.deletions = [v],
                m.flags |= 16) : S.push(v)
            }
        }
        function n(m, v) {
            if (!t)
                return null;
            for (; v !== null; )
                e(m, v),
                v = v.sibling;
            return null
        }
        function l(m) {
            for (var v = new Map; m !== null; )
                m.key !== null ? v.set(m.key, m) : v.set(m.index, m),
                m = m.sibling;
            return v
        }
        function a(m, v) {
            return m = Xe(m, v),
            m.index = 0,
            m.sibling = null,
            m
        }
        function u(m, v, S) {
            return m.index = S,
            t ? (S = m.alternate,
            S !== null ? (S = S.index,
            S < v ? (m.flags |= 67108866,
            v) : S) : (m.flags |= 67108866,
            v)) : (m.flags |= 1048576,
            v)
        }
        function o(m) {
            return t && m.alternate === null && (m.flags |= 67108866),
            m
        }
        function f(m, v, S, M) {
            return v === null || v.tag !== 6 ? (v = Ii(S, m.mode, M),
            v.return = m,
            v) : (v = a(v, S),
            v.return = m,
            v)
        }
        function d(m, v, S, M) {
            var B = S.type;
            return B === et ? O(m, v, S.props.children, M, S.key) : v !== null && (v.elementType === B || typeof B == "object" && B !== null && B.$$typeof === Tt && lf(B) === v.type) ? (v = a(v, S.props),
            ma(v, S),
            v.return = m,
            v) : (v = hu(S.type, S.key, S.props, null, m.mode, M),
            ma(v, S),
            v.return = m,
            v)
        }
        function p(m, v, S, M) {
            return v === null || v.tag !== 4 || v.stateNode.containerInfo !== S.containerInfo || v.stateNode.implementation !== S.implementation ? (v = Pi(S, m.mode, M),
            v.return = m,
            v) : (v = a(v, S.children || []),
            v.return = m,
            v)
        }
        function O(m, v, S, M, B) {
            return v === null || v.tag !== 7 ? (v = Qn(S, m.mode, M, B),
            v.return = m,
            v) : (v = a(v, S),
            v.return = m,
            v)
        }
        function w(m, v, S) {
            if (typeof v == "string" && v !== "" || typeof v == "number" || typeof v == "bigint")
                return v = Ii("" + v, m.mode, S),
                v.return = m,
                v;
            if (typeof v == "object" && v !== null) {
                switch (v.$$typeof) {
                case z:
                    return S = hu(v.type, v.key, v.props, null, m.mode, S),
                    ma(S, v),
                    S.return = m,
                    S;
                case G:
                    return v = Pi(v, m.mode, S),
                    v.return = m,
                    v;
                case Tt:
                    var M = v._init;
                    return v = M(v._payload),
                    w(m, v, S)
                }
                if (K(v) || Ct(v))
                    return v = Qn(v, m.mode, S, null),
                    v.return = m,
                    v;
                if (typeof v.then == "function")
                    return w(m, qu(v), S);
                if (v.$$typeof === St)
                    return w(m, vu(m, v), S);
                xu(m, v)
            }
            return null
        }
        function A(m, v, S, M) {
            var B = v !== null ? v.key : null;
            if (typeof S == "string" && S !== "" || typeof S == "number" || typeof S == "bigint")
                return B !== null ? null : f(m, v, "" + S, M);
            if (typeof S == "object" && S !== null) {
                switch (S.$$typeof) {
                case z:
                    return S.key === B ? d(m, v, S, M) : null;
                case G:
                    return S.key === B ? p(m, v, S, M) : null;
                case Tt:
                    return B = S._init,
                    S = B(S._payload),
                    A(m, v, S, M)
                }
                if (K(S) || Ct(S))
                    return B !== null ? null : O(m, v, S, M, null);
                if (typeof S.then == "function")
                    return A(m, v, qu(S), M);
                if (S.$$typeof === St)
                    return A(m, v, vu(m, S), M);
                xu(m, S)
            }
            return null
        }
        function R(m, v, S, M, B) {
            if (typeof M == "string" && M !== "" || typeof M == "number" || typeof M == "bigint")
                return m = m.get(S) || null,
                f(v, m, "" + M, B);
            if (typeof M == "object" && M !== null) {
                switch (M.$$typeof) {
                case z:
                    return m = m.get(M.key === null ? S : M.key) || null,
                    d(v, m, M, B);
                case G:
                    return m = m.get(M.key === null ? S : M.key) || null,
                    p(v, m, M, B);
                case Tt:
                    var tt = M._init;
                    return M = tt(M._payload),
                    R(m, v, S, M, B)
                }
                if (K(M) || Ct(M))
                    return m = m.get(S) || null,
                    O(v, m, M, B, null);
                if (typeof M.then == "function")
                    return R(m, v, S, qu(M), B);
                if (M.$$typeof === St)
                    return R(m, v, S, vu(v, M), B);
                xu(v, M)
            }
            return null
        }
        function k(m, v, S, M) {
            for (var B = null, tt = null, L = v, Y = v = 0, Nt = null; L !== null && Y < S.length; Y++) {
                L.index > Y ? (Nt = L,
                L = null) : Nt = L.sibling;
                var it = A(m, L, S[Y], M);
                if (it === null) {
                    L === null && (L = Nt);
                    break
                }
                t && L && it.alternate === null && e(m, L),
                v = u(it, v, Y),
                tt === null ? B = it : tt.sibling = it,
                tt = it,
                L = Nt
            }
            if (Y === S.length)
                return n(m, L),
                st && Hn(m, Y),
                B;
            if (L === null) {
                for (; Y < S.length; Y++)
                    L = w(m, S[Y], M),
                    L !== null && (v = u(L, v, Y),
                    tt === null ? B = L : tt.sibling = L,
                    tt = L);
                return st && Hn(m, Y),
                B
            }
            for (L = l(L); Y < S.length; Y++)
                Nt = R(L, m, Y, S[Y], M),
                Nt !== null && (t && Nt.alternate !== null && L.delete(Nt.key === null ? Y : Nt.key),
                v = u(Nt, v, Y),
                tt === null ? B = Nt : tt.sibling = Nt,
                tt = Nt);
            return t && L.forEach(function(wn) {
                return e(m, wn)
            }),
            st && Hn(m, Y),
            B
        }
        function V(m, v, S, M) {
            if (S == null)
                throw Error(r(151));
            for (var B = null, tt = null, L = v, Y = v = 0, Nt = null, it = S.next(); L !== null && !it.done; Y++,
            it = S.next()) {
                L.index > Y ? (Nt = L,
                L = null) : Nt = L.sibling;
                var wn = A(m, L, it.value, M);
                if (wn === null) {
                    L === null && (L = Nt);
                    break
                }
                t && L && wn.alternate === null && e(m, L),
                v = u(wn, v, Y),
                tt === null ? B = wn : tt.sibling = wn,
                tt = wn,
                L = Nt
            }
            if (it.done)
                return n(m, L),
                st && Hn(m, Y),
                B;
            if (L === null) {
                for (; !it.done; Y++,
                it = S.next())
                    it = w(m, it.value, M),
                    it !== null && (v = u(it, v, Y),
                    tt === null ? B = it : tt.sibling = it,
                    tt = it);
                return st && Hn(m, Y),
                B
            }
            for (L = l(L); !it.done; Y++,
            it = S.next())
                it = R(L, m, Y, it.value, M),
                it !== null && (t && it.alternate !== null && L.delete(it.key === null ? Y : it.key),
                v = u(it, v, Y),
                tt === null ? B = it : tt.sibling = it,
                tt = it);
            return t && L.forEach(function(rv) {
                return e(m, rv)
            }),
            st && Hn(m, Y),
            B
        }
        function ht(m, v, S, M) {
            if (typeof S == "object" && S !== null && S.type === et && S.key === null && (S = S.props.children),
            typeof S == "object" && S !== null) {
                switch (S.$$typeof) {
                case z:
                    t: {
                        for (var B = S.key; v !== null; ) {
                            if (v.key === B) {
                                if (B = S.type,
                                B === et) {
                                    if (v.tag === 7) {
                                        n(m, v.sibling),
                                        M = a(v, S.props.children),
                                        M.return = m,
                                        m = M;
                                        break t
                                    }
                                } else if (v.elementType === B || typeof B == "object" && B !== null && B.$$typeof === Tt && lf(B) === v.type) {
                                    n(m, v.sibling),
                                    M = a(v, S.props),
                                    ma(M, S),
                                    M.return = m,
                                    m = M;
                                    break t
                                }
                                n(m, v);
                                break
                            } else
                                e(m, v);
                            v = v.sibling
                        }
                        S.type === et ? (M = Qn(S.props.children, m.mode, M, S.key),
                        M.return = m,
                        m = M) : (M = hu(S.type, S.key, S.props, null, m.mode, M),
                        ma(M, S),
                        M.return = m,
                        m = M)
                    }
                    return o(m);
                case G:
                    t: {
                        for (B = S.key; v !== null; ) {
                            if (v.key === B)
                                if (v.tag === 4 && v.stateNode.containerInfo === S.containerInfo && v.stateNode.implementation === S.implementation) {
                                    n(m, v.sibling),
                                    M = a(v, S.children || []),
                                    M.return = m,
                                    m = M;
                                    break t
                                } else {
                                    n(m, v);
                                    break
                                }
                            else
                                e(m, v);
                            v = v.sibling
                        }
                        M = Pi(S, m.mode, M),
                        M.return = m,
                        m = M
                    }
                    return o(m);
                case Tt:
                    return B = S._init,
                    S = B(S._payload),
                    ht(m, v, S, M)
                }
                if (K(S))
                    return k(m, v, S, M);
                if (Ct(S)) {
                    if (B = Ct(S),
                    typeof B != "function")
                        throw Error(r(150));
                    return S = B.call(S),
                    V(m, v, S, M)
                }
                if (typeof S.then == "function")
                    return ht(m, v, qu(S), M);
                if (S.$$typeof === St)
                    return ht(m, v, vu(m, S), M);
                xu(m, S)
            }
            return typeof S == "string" && S !== "" || typeof S == "number" || typeof S == "bigint" ? (S = "" + S,
            v !== null && v.tag === 6 ? (n(m, v.sibling),
            M = a(v, S),
            M.return = m,
            m = M) : (n(m, v),
            M = Ii(S, m.mode, M),
            M.return = m,
            m = M),
            o(m)) : n(m, v)
        }
        return function(m, v, S, M) {
            try {
                va = 0;
                var B = ht(m, v, S, M);
                return El = null,
                B
            } catch (L) {
                if (L === sa || L === Su)
                    throw L;
                var tt = se(29, L, null, m.mode);
                return tt.lanes = M,
                tt.return = m,
                tt
            } finally {}
        }
    }
    var _l = af(!0)
      , uf = af(!1)
      , pe = q(null)
      , Ue = null;
    function dn(t) {
        var e = t.alternate;
        N(xt, xt.current & 1),
        N(pe, t),
        Ue === null && (e === null || bl.current !== null || e.memoizedState !== null) && (Ue = t)
    }
    function sf(t) {
        if (t.tag === 22) {
            if (N(xt, xt.current),
            N(pe, t),
            Ue === null) {
                var e = t.alternate;
                e !== null && e.memoizedState !== null && (Ue = t)
            }
        } else
            yn()
    }
    function yn() {
        N(xt, xt.current),
        N(pe, pe.current)
    }
    function We(t) {
        Q(pe),
        Ue === t && (Ue = null),
        Q(xt)
    }
    var xt = q(0);
    function Cu(t) {
        for (var e = t; e !== null; ) {
            if (e.tag === 13) {
                var n = e.memoizedState;
                if (n !== null && (n = n.dehydrated,
                n === null || n.data === "$?" || Tc(n)))
                    return e
            } else if (e.tag === 19 && e.memoizedProps.revealOrder !== void 0) {
                if ((e.flags & 128) !== 0)
                    return e
            } else if (e.child !== null) {
                e.child.return = e,
                e = e.child;
                continue
            }
            if (e === t)
                break;
            for (; e.sibling === null; ) {
                if (e.return === null || e.return === t)
                    return null;
                e = e.return
            }
            e.sibling.return = e.return,
            e = e.sibling
        }
        return null
    }
    function Ds(t, e, n, l) {
        e = t.memoizedState,
        n = n(l, e),
        n = n == null ? e : D({}, e, n),
        t.memoizedState = n,
        t.lanes === 0 && (t.updateQueue.baseState = n)
    }
    var zs = {
        enqueueSetState: function(t, e, n) {
            t = t._reactInternals;
            var l = fe()
              , a = on(l);
            a.payload = e,
            n != null && (a.callback = n),
            e = fn(t, a, l),
            e !== null && (he(e, t, l),
            ra(e, t, l))
        },
        enqueueReplaceState: function(t, e, n) {
            t = t._reactInternals;
            var l = fe()
              , a = on(l);
            a.tag = 1,
            a.payload = e,
            n != null && (a.callback = n),
            e = fn(t, a, l),
            e !== null && (he(e, t, l),
            ra(e, t, l))
        },
        enqueueForceUpdate: function(t, e) {
            t = t._reactInternals;
            var n = fe()
              , l = on(n);
            l.tag = 2,
            e != null && (l.callback = e),
            e = fn(t, l, n),
            e !== null && (he(e, t, n),
            ra(e, t, n))
        }
    };
    function cf(t, e, n, l, a, u, o) {
        return t = t.stateNode,
        typeof t.shouldComponentUpdate == "function" ? t.shouldComponentUpdate(l, u, o) : e.prototype && e.prototype.isPureReactComponent ? !Pl(n, l) || !Pl(a, u) : !0
    }
    function rf(t, e, n, l) {
        t = e.state,
        typeof e.componentWillReceiveProps == "function" && e.componentWillReceiveProps(n, l),
        typeof e.UNSAFE_componentWillReceiveProps == "function" && e.UNSAFE_componentWillReceiveProps(n, l),
        e.state !== t && zs.enqueueReplaceState(e, e.state, null)
    }
    function kn(t, e) {
        var n = e;
        if ("ref"in e) {
            n = {};
            for (var l in e)
                l !== "ref" && (n[l] = e[l])
        }
        if (t = t.defaultProps) {
            n === e && (n = D({}, n));
            for (var a in t)
                n[a] === void 0 && (n[a] = t[a])
        }
        return n
    }
    var Du = typeof reportError == "function" ? reportError : function(t) {
        if (typeof window == "object" && typeof window.ErrorEvent == "function") {
            var e = new window.ErrorEvent("error",{
                bubbles: !0,
                cancelable: !0,
                message: typeof t == "object" && t !== null && typeof t.message == "string" ? String(t.message) : String(t),
                error: t
            });
            if (!window.dispatchEvent(e))
                return
        } else if (typeof process == "object" && typeof process.emit == "function") {
            process.emit("uncaughtException", t);
            return
        }
        console.error(t)
    }
    ;
    function of(t) {
        Du(t)
    }
    function ff(t) {
        console.error(t)
    }
    function hf(t) {
        Du(t)
    }
    function zu(t, e) {
        try {
            var n = t.onUncaughtError;
            n(e.value, {
                componentStack: e.stack
            })
        } catch (l) {
            setTimeout(function() {
                throw l
            })
        }
    }
    function df(t, e, n) {
        try {
            var l = t.onCaughtError;
            l(n.value, {
                componentStack: n.stack,
                errorBoundary: e.tag === 1 ? e.stateNode : null
            })
        } catch (a) {
            setTimeout(function() {
                throw a
            })
        }
    }
    function Us(t, e, n) {
        return n = on(n),
        n.tag = 3,
        n.payload = {
            element: null
        },
        n.callback = function() {
            zu(t, e)
        }
        ,
        n
    }
    function yf(t) {
        return t = on(t),
        t.tag = 3,
        t
    }
    function gf(t, e, n, l) {
        var a = n.type.getDerivedStateFromError;
        if (typeof a == "function") {
            var u = l.value;
            t.payload = function() {
                return a(u)
            }
            ,
            t.callback = function() {
                df(e, n, l)
            }
        }
        var o = n.stateNode;
        o !== null && typeof o.componentDidCatch == "function" && (t.callback = function() {
            df(e, n, l),
            typeof a != "function" && (pn === null ? pn = new Set([this]) : pn.add(this));
            var f = l.stack;
            this.componentDidCatch(l.value, {
                componentStack: f !== null ? f : ""
            })
        }
        )
    }
    function rg(t, e, n, l, a) {
        if (n.flags |= 32768,
        l !== null && typeof l == "object" && typeof l.then == "function") {
            if (e = n.alternate,
            e !== null && aa(e, n, a, !0),
            n = pe.current,
            n !== null) {
                switch (n.tag) {
                case 13:
                    return Ue === null ? ac() : n.alternate === null && Et === 0 && (Et = 3),
                    n.flags &= -257,
                    n.flags |= 65536,
                    n.lanes = a,
                    l === rs ? n.flags |= 16384 : (e = n.updateQueue,
                    e === null ? n.updateQueue = new Set([l]) : e.add(l),
                    ic(t, l, a)),
                    !1;
                case 22:
                    return n.flags |= 65536,
                    l === rs ? n.flags |= 16384 : (e = n.updateQueue,
                    e === null ? (e = {
                        transitions: null,
                        markerInstances: null,
                        retryQueue: new Set([l])
                    },
                    n.updateQueue = e) : (n = e.retryQueue,
                    n === null ? e.retryQueue = new Set([l]) : n.add(l)),
                    ic(t, l, a)),
                    !1
                }
                throw Error(r(435, n.tag))
            }
            return ic(t, l, a),
            ac(),
            !1
        }
        if (st)
            return e = pe.current,
            e !== null ? ((e.flags & 65536) === 0 && (e.flags |= 256),
            e.flags |= 65536,
            e.lanes = a,
            l !== ns && (t = Error(r(422), {
                cause: l
            }),
            la(ve(t, n)))) : (l !== ns && (e = Error(r(423), {
                cause: l
            }),
            la(ve(e, n))),
            t = t.current.alternate,
            t.flags |= 65536,
            a &= -a,
            t.lanes |= a,
            l = ve(l, n),
            a = Us(t.stateNode, l, a),
            hs(t, a),
            Et !== 4 && (Et = 2)),
            !1;
        var u = Error(r(520), {
            cause: l
        });
        if (u = ve(u, n),
        _a === null ? _a = [u] : _a.push(u),
        Et !== 4 && (Et = 2),
        e === null)
            return !0;
        l = ve(l, n),
        n = e;
        do {
            switch (n.tag) {
            case 3:
                return n.flags |= 65536,
                t = a & -a,
                n.lanes |= t,
                t = Us(n.stateNode, l, t),
                hs(n, t),
                !1;
            case 1:
                if (e = n.type,
                u = n.stateNode,
                (n.flags & 128) === 0 && (typeof e.getDerivedStateFromError == "function" || u !== null && typeof u.componentDidCatch == "function" && (pn === null || !pn.has(u))))
                    return n.flags |= 65536,
                    a &= -a,
                    n.lanes |= a,
                    a = yf(a),
                    gf(a, t, n, l),
                    hs(n, a),
                    !1
            }
            n = n.return
        } while (n !== null);
        return !1
    }
    var vf = Error(r(461))
      , zt = !1;
    function Ht(t, e, n, l) {
        e.child = t === null ? uf(e, null, n, l) : _l(e, t.child, n, l)
    }
    function mf(t, e, n, l, a) {
        n = n.render;
        var u = e.ref;
        if ("ref"in l) {
            var o = {};
            for (var f in l)
                f !== "ref" && (o[f] = l[f])
        } else
            o = l;
        return Yn(e),
        l = ms(t, e, n, o, u, a),
        f = Ss(),
        t !== null && !zt ? (bs(t, e, a),
        Fe(t, e, a)) : (st && f && ts(e),
        e.flags |= 1,
        Ht(t, e, l, a),
        e.child)
    }
    function Sf(t, e, n, l, a) {
        if (t === null) {
            var u = n.type;
            return typeof u == "function" && !Fi(u) && u.defaultProps === void 0 && n.compare === null ? (e.tag = 15,
            e.type = u,
            bf(t, e, u, l, a)) : (t = hu(n.type, null, l, e, e.mode, a),
            t.ref = e.ref,
            t.return = e,
            e.child = t)
        }
        if (u = t.child,
        !Ys(t, a)) {
            var o = u.memoizedProps;
            if (n = n.compare,
            n = n !== null ? n : Pl,
            n(o, l) && t.ref === e.ref)
                return Fe(t, e, a)
        }
        return e.flags |= 1,
        t = Xe(u, l),
        t.ref = e.ref,
        t.return = e,
        e.child = t
    }
    function bf(t, e, n, l, a) {
        if (t !== null) {
            var u = t.memoizedProps;
            if (Pl(u, l) && t.ref === e.ref)
                if (zt = !1,
                e.pendingProps = l = u,
                Ys(t, a))
                    (t.flags & 131072) !== 0 && (zt = !0);
                else
                    return e.lanes = t.lanes,
                    Fe(t, e, a)
        }
        return Ns(t, e, n, l, a)
    }
    function pf(t, e, n) {
        var l = e.pendingProps
          , a = l.children
          , u = t !== null ? t.memoizedState : null;
        if (l.mode === "hidden") {
            if ((e.flags & 128) !== 0) {
                if (l = u !== null ? u.baseLanes | n : n,
                t !== null) {
                    for (a = e.child = t.child,
                    u = 0; a !== null; )
                        u = u | a.lanes | a.childLanes,
                        a = a.sibling;
                    e.childLanes = u & ~l
                } else
                    e.childLanes = 0,
                    e.child = null;
                return Tf(t, e, l, n)
            }
            if ((n & 536870912) !== 0)
                e.memoizedState = {
                    baseLanes: 0,
                    cachePool: null
                },
                t !== null && mu(e, u !== null ? u.cachePool : null),
                u !== null ? So(e, u) : ys(),
                sf(e);
            else
                return e.lanes = e.childLanes = 536870912,
                Tf(t, e, u !== null ? u.baseLanes | n : n, n)
        } else
            u !== null ? (mu(e, u.cachePool),
            So(e, u),
            yn(),
            e.memoizedState = null) : (t !== null && mu(e, null),
            ys(),
            yn());
        return Ht(t, e, a, n),
        e.child
    }
    function Tf(t, e, n, l) {
        var a = cs();
        return a = a === null ? null : {
            parent: qt._currentValue,
            pool: a
        },
        e.memoizedState = {
            baseLanes: n,
            cachePool: a
        },
        t !== null && mu(e, null),
        ys(),
        sf(e),
        t !== null && aa(t, e, l, !0),
        null
    }
    function Uu(t, e) {
        var n = e.ref;
        if (n === null)
            t !== null && t.ref !== null && (e.flags |= 4194816);
        else {
            if (typeof n != "function" && typeof n != "object")
                throw Error(r(284));
            (t === null || t.ref !== n) && (e.flags |= 4194816)
        }
    }
    function Ns(t, e, n, l, a) {
        return Yn(e),
        n = ms(t, e, n, l, void 0, a),
        l = Ss(),
        t !== null && !zt ? (bs(t, e, a),
        Fe(t, e, a)) : (st && l && ts(e),
        e.flags |= 1,
        Ht(t, e, n, a),
        e.child)
    }
    function Af(t, e, n, l, a, u) {
        return Yn(e),
        e.updateQueue = null,
        n = po(e, l, n, a),
        bo(t),
        l = Ss(),
        t !== null && !zt ? (bs(t, e, u),
        Fe(t, e, u)) : (st && l && ts(e),
        e.flags |= 1,
        Ht(t, e, n, u),
        e.child)
    }
    function Ef(t, e, n, l, a) {
        if (Yn(e),
        e.stateNode === null) {
            var u = yl
              , o = n.contextType;
            typeof o == "object" && o !== null && (u = Gt(o)),
            u = new n(l,u),
            e.memoizedState = u.state !== null && u.state !== void 0 ? u.state : null,
            u.updater = zs,
            e.stateNode = u,
            u._reactInternals = e,
            u = e.stateNode,
            u.props = l,
            u.state = e.memoizedState,
            u.refs = {},
            os(e),
            o = n.contextType,
            u.context = typeof o == "object" && o !== null ? Gt(o) : yl,
            u.state = e.memoizedState,
            o = n.getDerivedStateFromProps,
            typeof o == "function" && (Ds(e, n, o, l),
            u.state = e.memoizedState),
            typeof n.getDerivedStateFromProps == "function" || typeof u.getSnapshotBeforeUpdate == "function" || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (o = u.state,
            typeof u.componentWillMount == "function" && u.componentWillMount(),
            typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount(),
            o !== u.state && zs.enqueueReplaceState(u, u.state, null),
            fa(e, l, u, a),
            oa(),
            u.state = e.memoizedState),
            typeof u.componentDidMount == "function" && (e.flags |= 4194308),
            l = !0
        } else if (t === null) {
            u = e.stateNode;
            var f = e.memoizedProps
              , d = kn(n, f);
            u.props = d;
            var p = u.context
              , O = n.contextType;
            o = yl,
            typeof O == "object" && O !== null && (o = Gt(O));
            var w = n.getDerivedStateFromProps;
            O = typeof w == "function" || typeof u.getSnapshotBeforeUpdate == "function",
            f = e.pendingProps !== f,
            O || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (f || p !== o) && rf(e, u, l, o),
            rn = !1;
            var A = e.memoizedState;
            u.state = A,
            fa(e, l, u, a),
            oa(),
            p = e.memoizedState,
            f || A !== p || rn ? (typeof w == "function" && (Ds(e, n, w, l),
            p = e.memoizedState),
            (d = rn || cf(e, n, d, l, A, p, o)) ? (O || typeof u.UNSAFE_componentWillMount != "function" && typeof u.componentWillMount != "function" || (typeof u.componentWillMount == "function" && u.componentWillMount(),
            typeof u.UNSAFE_componentWillMount == "function" && u.UNSAFE_componentWillMount()),
            typeof u.componentDidMount == "function" && (e.flags |= 4194308)) : (typeof u.componentDidMount == "function" && (e.flags |= 4194308),
            e.memoizedProps = l,
            e.memoizedState = p),
            u.props = l,
            u.state = p,
            u.context = o,
            l = d) : (typeof u.componentDidMount == "function" && (e.flags |= 4194308),
            l = !1)
        } else {
            u = e.stateNode,
            fs(t, e),
            o = e.memoizedProps,
            O = kn(n, o),
            u.props = O,
            w = e.pendingProps,
            A = u.context,
            p = n.contextType,
            d = yl,
            typeof p == "object" && p !== null && (d = Gt(p)),
            f = n.getDerivedStateFromProps,
            (p = typeof f == "function" || typeof u.getSnapshotBeforeUpdate == "function") || typeof u.UNSAFE_componentWillReceiveProps != "function" && typeof u.componentWillReceiveProps != "function" || (o !== w || A !== d) && rf(e, u, l, d),
            rn = !1,
            A = e.memoizedState,
            u.state = A,
            fa(e, l, u, a),
            oa();
            var R = e.memoizedState;
            o !== w || A !== R || rn || t !== null && t.dependencies !== null && gu(t.dependencies) ? (typeof f == "function" && (Ds(e, n, f, l),
            R = e.memoizedState),
            (O = rn || cf(e, n, O, l, A, R, d) || t !== null && t.dependencies !== null && gu(t.dependencies)) ? (p || typeof u.UNSAFE_componentWillUpdate != "function" && typeof u.componentWillUpdate != "function" || (typeof u.componentWillUpdate == "function" && u.componentWillUpdate(l, R, d),
            typeof u.UNSAFE_componentWillUpdate == "function" && u.UNSAFE_componentWillUpdate(l, R, d)),
            typeof u.componentDidUpdate == "function" && (e.flags |= 4),
            typeof u.getSnapshotBeforeUpdate == "function" && (e.flags |= 1024)) : (typeof u.componentDidUpdate != "function" || o === t.memoizedProps && A === t.memoizedState || (e.flags |= 4),
            typeof u.getSnapshotBeforeUpdate != "function" || o === t.memoizedProps && A === t.memoizedState || (e.flags |= 1024),
            e.memoizedProps = l,
            e.memoizedState = R),
            u.props = l,
            u.state = R,
            u.context = d,
            l = O) : (typeof u.componentDidUpdate != "function" || o === t.memoizedProps && A === t.memoizedState || (e.flags |= 4),
            typeof u.getSnapshotBeforeUpdate != "function" || o === t.memoizedProps && A === t.memoizedState || (e.flags |= 1024),
            l = !1)
        }
        return u = l,
        Uu(t, e),
        l = (e.flags & 128) !== 0,
        u || l ? (u = e.stateNode,
        n = l && typeof n.getDerivedStateFromError != "function" ? null : u.render(),
        e.flags |= 1,
        t !== null && l ? (e.child = _l(e, t.child, null, a),
        e.child = _l(e, null, n, a)) : Ht(t, e, n, a),
        e.memoizedState = u.state,
        t = e.child) : t = Fe(t, e, a),
        t
    }
    function _f(t, e, n, l) {
        return na(),
        e.flags |= 256,
        Ht(t, e, n, l),
        e.child
    }
    var Qs = {
        dehydrated: null,
        treeContext: null,
        retryLane: 0,
        hydrationErrors: null
    };
    function Bs(t) {
        return {
            baseLanes: t,
            cachePool: ro()
        }
    }
    function Hs(t, e, n) {
        return t = t !== null ? t.childLanes & ~n : 0,
        e && (t |= Te),
        t
    }
    function Rf(t, e, n) {
        var l = e.pendingProps, a = !1, u = (e.flags & 128) !== 0, o;
        if ((o = u) || (o = t !== null && t.memoizedState === null ? !1 : (xt.current & 2) !== 0),
        o && (a = !0,
        e.flags &= -129),
        o = (e.flags & 32) !== 0,
        e.flags &= -33,
        t === null) {
            if (st) {
                if (a ? dn(e) : yn(),
                st) {
                    var f = At, d;
                    if (d = f) {
                        t: {
                            for (d = f,
                            f = ze; d.nodeType !== 8; ) {
                                if (!f) {
                                    f = null;
                                    break t
                                }
                                if (d = we(d.nextSibling),
                                d === null) {
                                    f = null;
                                    break t
                                }
                            }
                            f = d
                        }
                        f !== null ? (e.memoizedState = {
                            dehydrated: f,
                            treeContext: Bn !== null ? {
                                id: ke,
                                overflow: Ze
                            } : null,
                            retryLane: 536870912,
                            hydrationErrors: null
                        },
                        d = se(18, null, null, 0),
                        d.stateNode = f,
                        d.return = e,
                        e.child = d,
                        Kt = e,
                        At = null,
                        d = !0) : d = !1
                    }
                    d || jn(e)
                }
                if (f = e.memoizedState,
                f !== null && (f = f.dehydrated,
                f !== null))
                    return Tc(f) ? e.lanes = 32 : e.lanes = 536870912,
                    null;
                We(e)
            }
            return f = l.children,
            l = l.fallback,
            a ? (yn(),
            a = e.mode,
            f = Nu({
                mode: "hidden",
                children: f
            }, a),
            l = Qn(l, a, n, null),
            f.return = e,
            l.return = e,
            f.sibling = l,
            e.child = f,
            a = e.child,
            a.memoizedState = Bs(n),
            a.childLanes = Hs(t, o, n),
            e.memoizedState = Qs,
            l) : (dn(e),
            Ls(e, f))
        }
        if (d = t.memoizedState,
        d !== null && (f = d.dehydrated,
        f !== null)) {
            if (u)
                e.flags & 256 ? (dn(e),
                e.flags &= -257,
                e = js(t, e, n)) : e.memoizedState !== null ? (yn(),
                e.child = t.child,
                e.flags |= 128,
                e = null) : (yn(),
                a = l.fallback,
                f = e.mode,
                l = Nu({
                    mode: "visible",
                    children: l.children
                }, f),
                a = Qn(a, f, n, null),
                a.flags |= 2,
                l.return = e,
                a.return = e,
                l.sibling = a,
                e.child = l,
                _l(e, t.child, null, n),
                l = e.child,
                l.memoizedState = Bs(n),
                l.childLanes = Hs(t, o, n),
                e.memoizedState = Qs,
                e = a);
            else if (dn(e),
            Tc(f)) {
                if (o = f.nextSibling && f.nextSibling.dataset,
                o)
                    var p = o.dgst;
                o = p,
                l = Error(r(419)),
                l.stack = "",
                l.digest = o,
                la({
                    value: l,
                    source: null,
                    stack: null
                }),
                e = js(t, e, n)
            } else if (zt || aa(t, e, n, !1),
            o = (n & t.childLanes) !== 0,
            zt || o) {
                if (o = gt,
                o !== null && (l = n & -n,
                l = (l & 42) !== 0 ? 1 : Ai(l),
                l = (l & (o.suspendedLanes | n)) !== 0 ? 0 : l,
                l !== 0 && l !== d.retryLane))
                    throw d.retryLane = l,
                    dl(t, l),
                    he(o, t, l),
                    vf;
                f.data === "$?" || ac(),
                e = js(t, e, n)
            } else
                f.data === "$?" ? (e.flags |= 192,
                e.child = t.child,
                e = null) : (t = d.treeContext,
                At = we(f.nextSibling),
                Kt = e,
                st = !0,
                Ln = null,
                ze = !1,
                t !== null && (Se[be++] = ke,
                Se[be++] = Ze,
                Se[be++] = Bn,
                ke = t.id,
                Ze = t.overflow,
                Bn = e),
                e = Ls(e, l.children),
                e.flags |= 4096);
            return e
        }
        return a ? (yn(),
        a = l.fallback,
        f = e.mode,
        d = t.child,
        p = d.sibling,
        l = Xe(d, {
            mode: "hidden",
            children: l.children
        }),
        l.subtreeFlags = d.subtreeFlags & 65011712,
        p !== null ? a = Xe(p, a) : (a = Qn(a, f, n, null),
        a.flags |= 2),
        a.return = e,
        l.return = e,
        l.sibling = a,
        e.child = l,
        l = a,
        a = e.child,
        f = t.child.memoizedState,
        f === null ? f = Bs(n) : (d = f.cachePool,
        d !== null ? (p = qt._currentValue,
        d = d.parent !== p ? {
            parent: p,
            pool: p
        } : d) : d = ro(),
        f = {
            baseLanes: f.baseLanes | n,
            cachePool: d
        }),
        a.memoizedState = f,
        a.childLanes = Hs(t, o, n),
        e.memoizedState = Qs,
        l) : (dn(e),
        n = t.child,
        t = n.sibling,
        n = Xe(n, {
            mode: "visible",
            children: l.children
        }),
        n.return = e,
        n.sibling = null,
        t !== null && (o = e.deletions,
        o === null ? (e.deletions = [t],
        e.flags |= 16) : o.push(t)),
        e.child = n,
        e.memoizedState = null,
        n)
    }
    function Ls(t, e) {
        return e = Nu({
            mode: "visible",
            children: e
        }, t.mode),
        e.return = t,
        t.child = e
    }
    function Nu(t, e) {
        return t = se(22, t, null, e),
        t.lanes = 0,
        t.stateNode = {
            _visibility: 1,
            _pendingMarkers: null,
            _retryCache: null,
            _transitions: null
        },
        t
    }
    function js(t, e, n) {
        return _l(e, t.child, null, n),
        t = Ls(e, e.pendingProps.children),
        t.flags |= 2,
        e.memoizedState = null,
        t
    }
    function Of(t, e, n) {
        t.lanes |= e;
        var l = t.alternate;
        l !== null && (l.lanes |= e),
        as(t.return, e, n)
    }
    function Vs(t, e, n, l, a) {
        var u = t.memoizedState;
        u === null ? t.memoizedState = {
            isBackwards: e,
            rendering: null,
            renderingStartTime: 0,
            last: l,
            tail: n,
            tailMode: a
        } : (u.isBackwards = e,
        u.rendering = null,
        u.renderingStartTime = 0,
        u.last = l,
        u.tail = n,
        u.tailMode = a)
    }
    function Mf(t, e, n) {
        var l = e.pendingProps
          , a = l.revealOrder
          , u = l.tail;
        if (Ht(t, e, l.children, n),
        l = xt.current,
        (l & 2) !== 0)
            l = l & 1 | 2,
            e.flags |= 128;
        else {
            if (t !== null && (t.flags & 128) !== 0)
                t: for (t = e.child; t !== null; ) {
                    if (t.tag === 13)
                        t.memoizedState !== null && Of(t, n, e);
                    else if (t.tag === 19)
                        Of(t, n, e);
                    else if (t.child !== null) {
                        t.child.return = t,
                        t = t.child;
                        continue
                    }
                    if (t === e)
                        break t;
                    for (; t.sibling === null; ) {
                        if (t.return === null || t.return === e)
                            break t;
                        t = t.return
                    }
                    t.sibling.return = t.return,
                    t = t.sibling
                }
            l &= 1
        }
        switch (N(xt, l),
        a) {
        case "forwards":
            for (n = e.child,
            a = null; n !== null; )
                t = n.alternate,
                t !== null && Cu(t) === null && (a = n),
                n = n.sibling;
            n = a,
            n === null ? (a = e.child,
            e.child = null) : (a = n.sibling,
            n.sibling = null),
            Vs(e, !1, a, n, u);
            break;
        case "backwards":
            for (n = null,
            a = e.child,
            e.child = null; a !== null; ) {
                if (t = a.alternate,
                t !== null && Cu(t) === null) {
                    e.child = a;
                    break
                }
                t = a.sibling,
                a.sibling = n,
                n = a,
                a = t
            }
            Vs(e, !0, n, null, u);
            break;
        case "together":
            Vs(e, !1, null, null, void 0);
            break;
        default:
            e.memoizedState = null
        }
        return e.child
    }
    function Fe(t, e, n) {
        if (t !== null && (e.dependencies = t.dependencies),
        bn |= e.lanes,
        (n & e.childLanes) === 0)
            if (t !== null) {
                if (aa(t, e, n, !1),
                (n & e.childLanes) === 0)
                    return null
            } else
                return null;
        if (t !== null && e.child !== t.child)
            throw Error(r(153));
        if (e.child !== null) {
            for (t = e.child,
            n = Xe(t, t.pendingProps),
            e.child = n,
            n.return = e; t.sibling !== null; )
                t = t.sibling,
                n = n.sibling = Xe(t, t.pendingProps),
                n.return = e;
            n.sibling = null
        }
        return e.child
    }
    function Ys(t, e) {
        return (t.lanes & e) !== 0 ? !0 : (t = t.dependencies,
        !!(t !== null && gu(t)))
    }
    function og(t, e, n) {
        switch (e.tag) {
        case 3:
            vt(e, e.stateNode.containerInfo),
            cn(e, qt, t.memoizedState.cache),
            na();
            break;
        case 27:
        case 5:
            mi(e);
            break;
        case 4:
            vt(e, e.stateNode.containerInfo);
            break;
        case 10:
            cn(e, e.type, e.memoizedProps.value);
            break;
        case 13:
            var l = e.memoizedState;
            if (l !== null)
                return l.dehydrated !== null ? (dn(e),
                e.flags |= 128,
                null) : (n & e.child.childLanes) !== 0 ? Rf(t, e, n) : (dn(e),
                t = Fe(t, e, n),
                t !== null ? t.sibling : null);
            dn(e);
            break;
        case 19:
            var a = (t.flags & 128) !== 0;
            if (l = (n & e.childLanes) !== 0,
            l || (aa(t, e, n, !1),
            l = (n & e.childLanes) !== 0),
            a) {
                if (l)
                    return Mf(t, e, n);
                e.flags |= 128
            }
            if (a = e.memoizedState,
            a !== null && (a.rendering = null,
            a.tail = null,
            a.lastEffect = null),
            N(xt, xt.current),
            l)
                break;
            return null;
        case 22:
        case 23:
            return e.lanes = 0,
            pf(t, e, n);
        case 24:
            cn(e, qt, t.memoizedState.cache)
        }
        return Fe(t, e, n)
    }
    function wf(t, e, n) {
        if (t !== null)
            if (t.memoizedProps !== e.pendingProps)
                zt = !0;
            else {
                if (!Ys(t, n) && (e.flags & 128) === 0)
                    return zt = !1,
                    og(t, e, n);
                zt = (t.flags & 131072) !== 0
            }
        else
            zt = !1,
            st && (e.flags & 1048576) !== 0 && no(e, yu, e.index);
        switch (e.lanes = 0,
        e.tag) {
        case 16:
            t: {
                t = e.pendingProps;
                var l = e.elementType
                  , a = l._init;
                if (l = a(l._payload),
                e.type = l,
                typeof l == "function")
                    Fi(l) ? (t = kn(l, t),
                    e.tag = 1,
                    e = Ef(null, e, l, t, n)) : (e.tag = 0,
                    e = Ns(null, e, l, t, n));
                else {
                    if (l != null) {
                        if (a = l.$$typeof,
                        a === pt) {
                            e.tag = 11,
                            e = mf(null, e, l, t, n);
                            break t
                        } else if (a === wt) {
                            e.tag = 14,
                            e = Sf(null, e, l, t, n);
                            break t
                        }
                    }
                    throw e = Ve(l) || l,
                    Error(r(306, e, ""))
                }
            }
            return e;
        case 0:
            return Ns(t, e, e.type, e.pendingProps, n);
        case 1:
            return l = e.type,
            a = kn(l, e.pendingProps),
            Ef(t, e, l, a, n);
        case 3:
            t: {
                if (vt(e, e.stateNode.containerInfo),
                t === null)
                    throw Error(r(387));
                l = e.pendingProps;
                var u = e.memoizedState;
                a = u.element,
                fs(t, e),
                fa(e, l, null, n);
                var o = e.memoizedState;
                if (l = o.cache,
                cn(e, qt, l),
                l !== u.cache && us(e, [qt], n, !0),
                oa(),
                l = o.element,
                u.isDehydrated)
                    if (u = {
                        element: l,
                        isDehydrated: !1,
                        cache: o.cache
                    },
                    e.updateQueue.baseState = u,
                    e.memoizedState = u,
                    e.flags & 256) {
                        e = _f(t, e, l, n);
                        break t
                    } else if (l !== a) {
                        a = ve(Error(r(424)), e),
                        la(a),
                        e = _f(t, e, l, n);
                        break t
                    } else {
                        switch (t = e.stateNode.containerInfo,
                        t.nodeType) {
                        case 9:
                            t = t.body;
                            break;
                        default:
                            t = t.nodeName === "HTML" ? t.ownerDocument.body : t
                        }
                        for (At = we(t.firstChild),
                        Kt = e,
                        st = !0,
                        Ln = null,
                        ze = !0,
                        n = uf(e, null, l, n),
                        e.child = n; n; )
                            n.flags = n.flags & -3 | 4096,
                            n = n.sibling
                    }
                else {
                    if (na(),
                    l === a) {
                        e = Fe(t, e, n);
                        break t
                    }
                    Ht(t, e, l, n)
                }
                e = e.child
            }
            return e;
        case 26:
            return Uu(t, e),
            t === null ? (n = Dh(e.type, null, e.pendingProps, null)) ? e.memoizedState = n : st || (n = e.type,
            t = e.pendingProps,
            l = $u(J.current).createElement(n),
            l[Yt] = e,
            l[Ft] = t,
            jt(l, n, t),
            Dt(l),
            e.stateNode = l) : e.memoizedState = Dh(e.type, t.memoizedProps, e.pendingProps, t.memoizedState),
            null;
        case 27:
            return mi(e),
            t === null && st && (l = e.stateNode = qh(e.type, e.pendingProps, J.current),
            Kt = e,
            ze = !0,
            a = At,
            En(e.type) ? (Ac = a,
            At = we(l.firstChild)) : At = a),
            Ht(t, e, e.pendingProps.children, n),
            Uu(t, e),
            t === null && (e.flags |= 4194304),
            e.child;
        case 5:
            return t === null && st && ((a = l = At) && (l = Hg(l, e.type, e.pendingProps, ze),
            l !== null ? (e.stateNode = l,
            Kt = e,
            At = we(l.firstChild),
            ze = !1,
            a = !0) : a = !1),
            a || jn(e)),
            mi(e),
            a = e.type,
            u = e.pendingProps,
            o = t !== null ? t.memoizedProps : null,
            l = u.children,
            Sc(a, u) ? l = null : o !== null && Sc(a, o) && (e.flags |= 32),
            e.memoizedState !== null && (a = ms(t, e, ng, null, null, n),
            za._currentValue = a),
            Uu(t, e),
            Ht(t, e, l, n),
            e.child;
        case 6:
            return t === null && st && ((t = n = At) && (n = Lg(n, e.pendingProps, ze),
            n !== null ? (e.stateNode = n,
            Kt = e,
            At = null,
            t = !0) : t = !1),
            t || jn(e)),
            null;
        case 13:
            return Rf(t, e, n);
        case 4:
            return vt(e, e.stateNode.containerInfo),
            l = e.pendingProps,
            t === null ? e.child = _l(e, null, l, n) : Ht(t, e, l, n),
            e.child;
        case 11:
            return mf(t, e, e.type, e.pendingProps, n);
        case 7:
            return Ht(t, e, e.pendingProps, n),
            e.child;
        case 8:
            return Ht(t, e, e.pendingProps.children, n),
            e.child;
        case 12:
            return Ht(t, e, e.pendingProps.children, n),
            e.child;
        case 10:
            return l = e.pendingProps,
            cn(e, e.type, l.value),
            Ht(t, e, l.children, n),
            e.child;
        case 9:
            return a = e.type._context,
            l = e.pendingProps.children,
            Yn(e),
            a = Gt(a),
            l = l(a),
            e.flags |= 1,
            Ht(t, e, l, n),
            e.child;
        case 14:
            return Sf(t, e, e.type, e.pendingProps, n);
        case 15:
            return bf(t, e, e.type, e.pendingProps, n);
        case 19:
            return Mf(t, e, n);
        case 31:
            return l = e.pendingProps,
            n = e.mode,
            l = {
                mode: l.mode,
                children: l.children
            },
            t === null ? (n = Nu(l, n),
            n.ref = e.ref,
            e.child = n,
            n.return = e,
            e = n) : (n = Xe(t.child, l),
            n.ref = e.ref,
            e.child = n,
            n.return = e,
            e = n),
            e;
        case 22:
            return pf(t, e, n);
        case 24:
            return Yn(e),
            l = Gt(qt),
            t === null ? (a = cs(),
            a === null && (a = gt,
            u = is(),
            a.pooledCache = u,
            u.refCount++,
            u !== null && (a.pooledCacheLanes |= n),
            a = u),
            e.memoizedState = {
                parent: l,
                cache: a
            },
            os(e),
            cn(e, qt, a)) : ((t.lanes & n) !== 0 && (fs(t, e),
            fa(e, null, null, n),
            oa()),
            a = t.memoizedState,
            u = e.memoizedState,
            a.parent !== l ? (a = {
                parent: l,
                cache: l
            },
            e.memoizedState = a,
            e.lanes === 0 && (e.memoizedState = e.updateQueue.baseState = a),
            cn(e, qt, l)) : (l = u.cache,
            cn(e, qt, l),
            l !== a.cache && us(e, [qt], n, !0))),
            Ht(t, e, e.pendingProps.children, n),
            e.child;
        case 29:
            throw e.pendingProps
        }
        throw Error(r(156, e.tag))
    }
    function Ie(t) {
        t.flags |= 4
    }
    function qf(t, e) {
        if (e.type !== "stylesheet" || (e.state.loading & 4) !== 0)
            t.flags &= -16777217;
        else if (t.flags |= 16777216,
        !Bh(e)) {
            if (e = pe.current,
            e !== null && ((at & 4194048) === at ? Ue !== null : (at & 62914560) !== at && (at & 536870912) === 0 || e !== Ue))
                throw ca = rs,
                oo;
            t.flags |= 8192
        }
    }
    function Qu(t, e) {
        e !== null && (t.flags |= 4),
        t.flags & 16384 && (e = t.tag !== 22 ? ur() : 536870912,
        t.lanes |= e,
        wl |= e)
    }
    function Sa(t, e) {
        if (!st)
            switch (t.tailMode) {
            case "hidden":
                e = t.tail;
                for (var n = null; e !== null; )
                    e.alternate !== null && (n = e),
                    e = e.sibling;
                n === null ? t.tail = null : n.sibling = null;
                break;
            case "collapsed":
                n = t.tail;
                for (var l = null; n !== null; )
                    n.alternate !== null && (l = n),
                    n = n.sibling;
                l === null ? e || t.tail === null ? t.tail = null : t.tail.sibling = null : l.sibling = null
            }
    }
    function bt(t) {
        var e = t.alternate !== null && t.alternate.child === t.child
          , n = 0
          , l = 0;
        if (e)
            for (var a = t.child; a !== null; )
                n |= a.lanes | a.childLanes,
                l |= a.subtreeFlags & 65011712,
                l |= a.flags & 65011712,
                a.return = t,
                a = a.sibling;
        else
            for (a = t.child; a !== null; )
                n |= a.lanes | a.childLanes,
                l |= a.subtreeFlags,
                l |= a.flags,
                a.return = t,
                a = a.sibling;
        return t.subtreeFlags |= l,
        t.childLanes = n,
        e
    }
    function fg(t, e, n) {
        var l = e.pendingProps;
        switch (es(e),
        e.tag) {
        case 31:
        case 16:
        case 15:
        case 0:
        case 11:
        case 7:
        case 8:
        case 12:
        case 9:
        case 14:
            return bt(e),
            null;
        case 1:
            return bt(e),
            null;
        case 3:
            return n = e.stateNode,
            l = null,
            t !== null && (l = t.memoizedState.cache),
            e.memoizedState.cache !== l && (e.flags |= 2048),
            Je(qt),
            ln(),
            n.pendingContext && (n.context = n.pendingContext,
            n.pendingContext = null),
            (t === null || t.child === null) && (ea(e) ? Ie(e) : t === null || t.memoizedState.isDehydrated && (e.flags & 256) === 0 || (e.flags |= 1024,
            uo())),
            bt(e),
            null;
        case 26:
            return n = e.memoizedState,
            t === null ? (Ie(e),
            n !== null ? (bt(e),
            qf(e, n)) : (bt(e),
            e.flags &= -16777217)) : n ? n !== t.memoizedState ? (Ie(e),
            bt(e),
            qf(e, n)) : (bt(e),
            e.flags &= -16777217) : (t.memoizedProps !== l && Ie(e),
            bt(e),
            e.flags &= -16777217),
            null;
        case 27:
            Ka(e),
            n = J.current;
            var a = e.type;
            if (t !== null && e.stateNode != null)
                t.memoizedProps !== l && Ie(e);
            else {
                if (!l) {
                    if (e.stateNode === null)
                        throw Error(r(166));
                    return bt(e),
                    null
                }
                t = j.current,
                ea(e) ? lo(e) : (t = qh(a, l, n),
                e.stateNode = t,
                Ie(e))
            }
            return bt(e),
            null;
        case 5:
            if (Ka(e),
            n = e.type,
            t !== null && e.stateNode != null)
                t.memoizedProps !== l && Ie(e);
            else {
                if (!l) {
                    if (e.stateNode === null)
                        throw Error(r(166));
                    return bt(e),
                    null
                }
                if (t = j.current,
                ea(e))
                    lo(e);
                else {
                    switch (a = $u(J.current),
                    t) {
                    case 1:
                        t = a.createElementNS("http://www.w3.org/2000/svg", n);
                        break;
                    case 2:
                        t = a.createElementNS("http://www.w3.org/1998/Math/MathML", n);
                        break;
                    default:
                        switch (n) {
                        case "svg":
                            t = a.createElementNS("http://www.w3.org/2000/svg", n);
                            break;
                        case "math":
                            t = a.createElementNS("http://www.w3.org/1998/Math/MathML", n);
                            break;
                        case "script":
                            t = a.createElement("div"),
                            t.innerHTML = "<script><\/script>",
                            t = t.removeChild(t.firstChild);
                            break;
                        case "select":
                            t = typeof l.is == "string" ? a.createElement("select", {
                                is: l.is
                            }) : a.createElement("select"),
                            l.multiple ? t.multiple = !0 : l.size && (t.size = l.size);
                            break;
                        default:
                            t = typeof l.is == "string" ? a.createElement(n, {
                                is: l.is
                            }) : a.createElement(n)
                        }
                    }
                    t[Yt] = e,
                    t[Ft] = l;
                    t: for (a = e.child; a !== null; ) {
                        if (a.tag === 5 || a.tag === 6)
                            t.appendChild(a.stateNode);
                        else if (a.tag !== 4 && a.tag !== 27 && a.child !== null) {
                            a.child.return = a,
                            a = a.child;
                            continue
                        }
                        if (a === e)
                            break t;
                        for (; a.sibling === null; ) {
                            if (a.return === null || a.return === e)
                                break t;
                            a = a.return
                        }
                        a.sibling.return = a.return,
                        a = a.sibling
                    }
                    e.stateNode = t;
                    t: switch (jt(t, n, l),
                    n) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                        t = !!l.autoFocus;
                        break t;
                    case "img":
                        t = !0;
                        break t;
                    default:
                        t = !1
                    }
                    t && Ie(e)
                }
            }
            return bt(e),
            e.flags &= -16777217,
            null;
        case 6:
            if (t && e.stateNode != null)
                t.memoizedProps !== l && Ie(e);
            else {
                if (typeof l != "string" && e.stateNode === null)
                    throw Error(r(166));
                if (t = J.current,
                ea(e)) {
                    if (t = e.stateNode,
                    n = e.memoizedProps,
                    l = null,
                    a = Kt,
                    a !== null)
                        switch (a.tag) {
                        case 27:
                        case 5:
                            l = a.memoizedProps
                        }
                    t[Yt] = e,
                    t = !!(t.nodeValue === n || l !== null && l.suppressHydrationWarning === !0 || Ah(t.nodeValue, n)),
                    t || jn(e)
                } else
                    t = $u(t).createTextNode(l),
                    t[Yt] = e,
                    e.stateNode = t
            }
            return bt(e),
            null;
        case 13:
            if (l = e.memoizedState,
            t === null || t.memoizedState !== null && t.memoizedState.dehydrated !== null) {
                if (a = ea(e),
                l !== null && l.dehydrated !== null) {
                    if (t === null) {
                        if (!a)
                            throw Error(r(318));
                        if (a = e.memoizedState,
                        a = a !== null ? a.dehydrated : null,
                        !a)
                            throw Error(r(317));
                        a[Yt] = e
                    } else
                        na(),
                        (e.flags & 128) === 0 && (e.memoizedState = null),
                        e.flags |= 4;
                    bt(e),
                    a = !1
                } else
                    a = uo(),
                    t !== null && t.memoizedState !== null && (t.memoizedState.hydrationErrors = a),
                    a = !0;
                if (!a)
                    return e.flags & 256 ? (We(e),
                    e) : (We(e),
                    null)
            }
            if (We(e),
            (e.flags & 128) !== 0)
                return e.lanes = n,
                e;
            if (n = l !== null,
            t = t !== null && t.memoizedState !== null,
            n) {
                l = e.child,
                a = null,
                l.alternate !== null && l.alternate.memoizedState !== null && l.alternate.memoizedState.cachePool !== null && (a = l.alternate.memoizedState.cachePool.pool);
                var u = null;
                l.memoizedState !== null && l.memoizedState.cachePool !== null && (u = l.memoizedState.cachePool.pool),
                u !== a && (l.flags |= 2048)
            }
            return n !== t && n && (e.child.flags |= 8192),
            Qu(e, e.updateQueue),
            bt(e),
            null;
        case 4:
            return ln(),
            t === null && dc(e.stateNode.containerInfo),
            bt(e),
            null;
        case 10:
            return Je(e.type),
            bt(e),
            null;
        case 19:
            if (Q(xt),
            a = e.memoizedState,
            a === null)
                return bt(e),
                null;
            if (l = (e.flags & 128) !== 0,
            u = a.rendering,
            u === null)
                if (l)
                    Sa(a, !1);
                else {
                    if (Et !== 0 || t !== null && (t.flags & 128) !== 0)
                        for (t = e.child; t !== null; ) {
                            if (u = Cu(t),
                            u !== null) {
                                for (e.flags |= 128,
                                Sa(a, !1),
                                t = u.updateQueue,
                                e.updateQueue = t,
                                Qu(e, t),
                                e.subtreeFlags = 0,
                                t = n,
                                n = e.child; n !== null; )
                                    eo(n, t),
                                    n = n.sibling;
                                return N(xt, xt.current & 1 | 2),
                                e.child
                            }
                            t = t.sibling
                        }
                    a.tail !== null && De() > Lu && (e.flags |= 128,
                    l = !0,
                    Sa(a, !1),
                    e.lanes = 4194304)
                }
            else {
                if (!l)
                    if (t = Cu(u),
                    t !== null) {
                        if (e.flags |= 128,
                        l = !0,
                        t = t.updateQueue,
                        e.updateQueue = t,
                        Qu(e, t),
                        Sa(a, !0),
                        a.tail === null && a.tailMode === "hidden" && !u.alternate && !st)
                            return bt(e),
                            null
                    } else
                        2 * De() - a.renderingStartTime > Lu && n !== 536870912 && (e.flags |= 128,
                        l = !0,
                        Sa(a, !1),
                        e.lanes = 4194304);
                a.isBackwards ? (u.sibling = e.child,
                e.child = u) : (t = a.last,
                t !== null ? t.sibling = u : e.child = u,
                a.last = u)
            }
            return a.tail !== null ? (e = a.tail,
            a.rendering = e,
            a.tail = e.sibling,
            a.renderingStartTime = De(),
            e.sibling = null,
            t = xt.current,
            N(xt, l ? t & 1 | 2 : t & 1),
            e) : (bt(e),
            null);
        case 22:
        case 23:
            return We(e),
            gs(),
            l = e.memoizedState !== null,
            t !== null ? t.memoizedState !== null !== l && (e.flags |= 8192) : l && (e.flags |= 8192),
            l ? (n & 536870912) !== 0 && (e.flags & 128) === 0 && (bt(e),
            e.subtreeFlags & 6 && (e.flags |= 8192)) : bt(e),
            n = e.updateQueue,
            n !== null && Qu(e, n.retryQueue),
            n = null,
            t !== null && t.memoizedState !== null && t.memoizedState.cachePool !== null && (n = t.memoizedState.cachePool.pool),
            l = null,
            e.memoizedState !== null && e.memoizedState.cachePool !== null && (l = e.memoizedState.cachePool.pool),
            l !== n && (e.flags |= 2048),
            t !== null && Q(Gn),
            null;
        case 24:
            return n = null,
            t !== null && (n = t.memoizedState.cache),
            e.memoizedState.cache !== n && (e.flags |= 2048),
            Je(qt),
            bt(e),
            null;
        case 25:
            return null;
        case 30:
            return null
        }
        throw Error(r(156, e.tag))
    }
    function hg(t, e) {
        switch (es(e),
        e.tag) {
        case 1:
            return t = e.flags,
            t & 65536 ? (e.flags = t & -65537 | 128,
            e) : null;
        case 3:
            return Je(qt),
            ln(),
            t = e.flags,
            (t & 65536) !== 0 && (t & 128) === 0 ? (e.flags = t & -65537 | 128,
            e) : null;
        case 26:
        case 27:
        case 5:
            return Ka(e),
            null;
        case 13:
            if (We(e),
            t = e.memoizedState,
            t !== null && t.dehydrated !== null) {
                if (e.alternate === null)
                    throw Error(r(340));
                na()
            }
            return t = e.flags,
            t & 65536 ? (e.flags = t & -65537 | 128,
            e) : null;
        case 19:
            return Q(xt),
            null;
        case 4:
            return ln(),
            null;
        case 10:
            return Je(e.type),
            null;
        case 22:
        case 23:
            return We(e),
            gs(),
            t !== null && Q(Gn),
            t = e.flags,
            t & 65536 ? (e.flags = t & -65537 | 128,
            e) : null;
        case 24:
            return Je(qt),
            null;
        case 25:
            return null;
        default:
            return null
        }
    }
    function xf(t, e) {
        switch (es(e),
        e.tag) {
        case 3:
            Je(qt),
            ln();
            break;
        case 26:
        case 27:
        case 5:
            Ka(e);
            break;
        case 4:
            ln();
            break;
        case 13:
            We(e);
            break;
        case 19:
            Q(xt);
            break;
        case 10:
            Je(e.type);
            break;
        case 22:
        case 23:
            We(e),
            gs(),
            t !== null && Q(Gn);
            break;
        case 24:
            Je(qt)
        }
    }
    function ba(t, e) {
        try {
            var n = e.updateQueue
              , l = n !== null ? n.lastEffect : null;
            if (l !== null) {
                var a = l.next;
                n = a;
                do {
                    if ((n.tag & t) === t) {
                        l = void 0;
                        var u = n.create
                          , o = n.inst;
                        l = u(),
                        o.destroy = l
                    }
                    n = n.next
                } while (n !== a)
            }
        } catch (f) {
            dt(e, e.return, f)
        }
    }
    function gn(t, e, n) {
        try {
            var l = e.updateQueue
              , a = l !== null ? l.lastEffect : null;
            if (a !== null) {
                var u = a.next;
                l = u;
                do {
                    if ((l.tag & t) === t) {
                        var o = l.inst
                          , f = o.destroy;
                        if (f !== void 0) {
                            o.destroy = void 0,
                            a = e;
                            var d = n
                              , p = f;
                            try {
                                p()
                            } catch (O) {
                                dt(a, d, O)
                            }
                        }
                    }
                    l = l.next
                } while (l !== u)
            }
        } catch (O) {
            dt(e, e.return, O)
        }
    }
    function Cf(t) {
        var e = t.updateQueue;
        if (e !== null) {
            var n = t.stateNode;
            try {
                mo(e, n)
            } catch (l) {
                dt(t, t.return, l)
            }
        }
    }
    function Df(t, e, n) {
        n.props = kn(t.type, t.memoizedProps),
        n.state = t.memoizedState;
        try {
            n.componentWillUnmount()
        } catch (l) {
            dt(t, e, l)
        }
    }
    function pa(t, e) {
        try {
            var n = t.ref;
            if (n !== null) {
                switch (t.tag) {
                case 26:
                case 27:
                case 5:
                    var l = t.stateNode;
                    break;
                case 30:
                    l = t.stateNode;
                    break;
                default:
                    l = t.stateNode
                }
                typeof n == "function" ? t.refCleanup = n(l) : n.current = l
            }
        } catch (a) {
            dt(t, e, a)
        }
    }
    function Ne(t, e) {
        var n = t.ref
          , l = t.refCleanup;
        if (n !== null)
            if (typeof l == "function")
                try {
                    l()
                } catch (a) {
                    dt(t, e, a)
                } finally {
                    t.refCleanup = null,
                    t = t.alternate,
                    t != null && (t.refCleanup = null)
                }
            else if (typeof n == "function")
                try {
                    n(null)
                } catch (a) {
                    dt(t, e, a)
                }
            else
                n.current = null
    }
    function zf(t) {
        var e = t.type
          , n = t.memoizedProps
          , l = t.stateNode;
        try {
            t: switch (e) {
            case "button":
            case "input":
            case "select":
            case "textarea":
                n.autoFocus && l.focus();
                break t;
            case "img":
                n.src ? l.src = n.src : n.srcSet && (l.srcset = n.srcSet)
            }
        } catch (a) {
            dt(t, t.return, a)
        }
    }
    function Gs(t, e, n) {
        try {
            var l = t.stateNode;
            zg(l, t.type, n, e),
            l[Ft] = e
        } catch (a) {
            dt(t, t.return, a)
        }
    }
    function Uf(t) {
        return t.tag === 5 || t.tag === 3 || t.tag === 26 || t.tag === 27 && En(t.type) || t.tag === 4
    }
    function Xs(t) {
        t: for (; ; ) {
            for (; t.sibling === null; ) {
                if (t.return === null || Uf(t.return))
                    return null;
                t = t.return
            }
            for (t.sibling.return = t.return,
            t = t.sibling; t.tag !== 5 && t.tag !== 6 && t.tag !== 18; ) {
                if (t.tag === 27 && En(t.type) || t.flags & 2 || t.child === null || t.tag === 4)
                    continue t;
                t.child.return = t,
                t = t.child
            }
            if (!(t.flags & 2))
                return t.stateNode
        }
    }
    function ks(t, e, n) {
        var l = t.tag;
        if (l === 5 || l === 6)
            t = t.stateNode,
            e ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(t, e) : (e = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n,
            e.appendChild(t),
            n = n._reactRootContainer,
            n != null || e.onclick !== null || (e.onclick = Ju));
        else if (l !== 4 && (l === 27 && En(t.type) && (n = t.stateNode,
        e = null),
        t = t.child,
        t !== null))
            for (ks(t, e, n),
            t = t.sibling; t !== null; )
                ks(t, e, n),
                t = t.sibling
    }
    function Bu(t, e, n) {
        var l = t.tag;
        if (l === 5 || l === 6)
            t = t.stateNode,
            e ? n.insertBefore(t, e) : n.appendChild(t);
        else if (l !== 4 && (l === 27 && En(t.type) && (n = t.stateNode),
        t = t.child,
        t !== null))
            for (Bu(t, e, n),
            t = t.sibling; t !== null; )
                Bu(t, e, n),
                t = t.sibling
    }
    function Nf(t) {
        var e = t.stateNode
          , n = t.memoizedProps;
        try {
            for (var l = t.type, a = e.attributes; a.length; )
                e.removeAttributeNode(a[0]);
            jt(e, l, n),
            e[Yt] = t,
            e[Ft] = n
        } catch (u) {
            dt(t, t.return, u)
        }
    }
    var Pe = !1
      , Rt = !1
      , Zs = !1
      , Qf = typeof WeakSet == "function" ? WeakSet : Set
      , Ut = null;
    function dg(t, e) {
        if (t = t.containerInfo,
        vc = ei,
        t = kr(t),
        Xi(t)) {
            if ("selectionStart"in t)
                var n = {
                    start: t.selectionStart,
                    end: t.selectionEnd
                };
            else
                t: {
                    n = (n = t.ownerDocument) && n.defaultView || window;
                    var l = n.getSelection && n.getSelection();
                    if (l && l.rangeCount !== 0) {
                        n = l.anchorNode;
                        var a = l.anchorOffset
                          , u = l.focusNode;
                        l = l.focusOffset;
                        try {
                            n.nodeType,
                            u.nodeType
                        } catch {
                            n = null;
                            break t
                        }
                        var o = 0
                          , f = -1
                          , d = -1
                          , p = 0
                          , O = 0
                          , w = t
                          , A = null;
                        e: for (; ; ) {
                            for (var R; w !== n || a !== 0 && w.nodeType !== 3 || (f = o + a),
                            w !== u || l !== 0 && w.nodeType !== 3 || (d = o + l),
                            w.nodeType === 3 && (o += w.nodeValue.length),
                            (R = w.firstChild) !== null; )
                                A = w,
                                w = R;
                            for (; ; ) {
                                if (w === t)
                                    break e;
                                if (A === n && ++p === a && (f = o),
                                A === u && ++O === l && (d = o),
                                (R = w.nextSibling) !== null)
                                    break;
                                w = A,
                                A = w.parentNode
                            }
                            w = R
                        }
                        n = f === -1 || d === -1 ? null : {
                            start: f,
                            end: d
                        }
                    } else
                        n = null
                }
            n = n || {
                start: 0,
                end: 0
            }
        } else
            n = null;
        for (mc = {
            focusedElem: t,
            selectionRange: n
        },
        ei = !1,
        Ut = e; Ut !== null; )
            if (e = Ut,
            t = e.child,
            (e.subtreeFlags & 1024) !== 0 && t !== null)
                t.return = e,
                Ut = t;
            else
                for (; Ut !== null; ) {
                    switch (e = Ut,
                    u = e.alternate,
                    t = e.flags,
                    e.tag) {
                    case 0:
                        break;
                    case 11:
                    case 15:
                        break;
                    case 1:
                        if ((t & 1024) !== 0 && u !== null) {
                            t = void 0,
                            n = e,
                            a = u.memoizedProps,
                            u = u.memoizedState,
                            l = n.stateNode;
                            try {
                                var k = kn(n.type, a, n.elementType === n.type);
                                t = l.getSnapshotBeforeUpdate(k, u),
                                l.__reactInternalSnapshotBeforeUpdate = t
                            } catch (V) {
                                dt(n, n.return, V)
                            }
                        }
                        break;
                    case 3:
                        if ((t & 1024) !== 0) {
                            if (t = e.stateNode.containerInfo,
                            n = t.nodeType,
                            n === 9)
                                pc(t);
                            else if (n === 1)
                                switch (t.nodeName) {
                                case "HEAD":
                                case "HTML":
                                case "BODY":
                                    pc(t);
                                    break;
                                default:
                                    t.textContent = ""
                                }
                        }
                        break;
                    case 5:
                    case 26:
                    case 27:
                    case 6:
                    case 4:
                    case 17:
                        break;
                    default:
                        if ((t & 1024) !== 0)
                            throw Error(r(163))
                    }
                    if (t = e.sibling,
                    t !== null) {
                        t.return = e.return,
                        Ut = t;
                        break
                    }
                    Ut = e.return
                }
    }
    function Bf(t, e, n) {
        var l = n.flags;
        switch (n.tag) {
        case 0:
        case 11:
        case 15:
            vn(t, n),
            l & 4 && ba(5, n);
            break;
        case 1:
            if (vn(t, n),
            l & 4)
                if (t = n.stateNode,
                e === null)
                    try {
                        t.componentDidMount()
                    } catch (o) {
                        dt(n, n.return, o)
                    }
                else {
                    var a = kn(n.type, e.memoizedProps);
                    e = e.memoizedState;
                    try {
                        t.componentDidUpdate(a, e, t.__reactInternalSnapshotBeforeUpdate)
                    } catch (o) {
                        dt(n, n.return, o)
                    }
                }
            l & 64 && Cf(n),
            l & 512 && pa(n, n.return);
            break;
        case 3:
            if (vn(t, n),
            l & 64 && (t = n.updateQueue,
            t !== null)) {
                if (e = null,
                n.child !== null)
                    switch (n.child.tag) {
                    case 27:
                    case 5:
                        e = n.child.stateNode;
                        break;
                    case 1:
                        e = n.child.stateNode
                    }
                try {
                    mo(t, e)
                } catch (o) {
                    dt(n, n.return, o)
                }
            }
            break;
        case 27:
            e === null && l & 4 && Nf(n);
        case 26:
        case 5:
            vn(t, n),
            e === null && l & 4 && zf(n),
            l & 512 && pa(n, n.return);
            break;
        case 12:
            vn(t, n);
            break;
        case 13:
            vn(t, n),
            l & 4 && jf(t, n),
            l & 64 && (t = n.memoizedState,
            t !== null && (t = t.dehydrated,
            t !== null && (n = Ag.bind(null, n),
            jg(t, n))));
            break;
        case 22:
            if (l = n.memoizedState !== null || Pe,
            !l) {
                e = e !== null && e.memoizedState !== null || Rt,
                a = Pe;
                var u = Rt;
                Pe = l,
                (Rt = e) && !u ? mn(t, n, (n.subtreeFlags & 8772) !== 0) : vn(t, n),
                Pe = a,
                Rt = u
            }
            break;
        case 30:
            break;
        default:
            vn(t, n)
        }
    }
    function Hf(t) {
        var e = t.alternate;
        e !== null && (t.alternate = null,
        Hf(e)),
        t.child = null,
        t.deletions = null,
        t.sibling = null,
        t.tag === 5 && (e = t.stateNode,
        e !== null && Ri(e)),
        t.stateNode = null,
        t.return = null,
        t.dependencies = null,
        t.memoizedProps = null,
        t.memoizedState = null,
        t.pendingProps = null,
        t.stateNode = null,
        t.updateQueue = null
    }
    var mt = null
      , te = !1;
    function tn(t, e, n) {
        for (n = n.child; n !== null; )
            Lf(t, e, n),
            n = n.sibling
    }
    function Lf(t, e, n) {
        if (ae && typeof ae.onCommitFiberUnmount == "function")
            try {
                ae.onCommitFiberUnmount(Vl, n)
            } catch {}
        switch (n.tag) {
        case 26:
            Rt || Ne(n, e),
            tn(t, e, n),
            n.memoizedState ? n.memoizedState.count-- : n.stateNode && (n = n.stateNode,
            n.parentNode.removeChild(n));
            break;
        case 27:
            Rt || Ne(n, e);
            var l = mt
              , a = te;
            En(n.type) && (mt = n.stateNode,
            te = !1),
            tn(t, e, n),
            qa(n.stateNode),
            mt = l,
            te = a;
            break;
        case 5:
            Rt || Ne(n, e);
        case 6:
            if (l = mt,
            a = te,
            mt = null,
            tn(t, e, n),
            mt = l,
            te = a,
            mt !== null)
                if (te)
                    try {
                        (mt.nodeType === 9 ? mt.body : mt.nodeName === "HTML" ? mt.ownerDocument.body : mt).removeChild(n.stateNode)
                    } catch (u) {
                        dt(n, e, u)
                    }
                else
                    try {
                        mt.removeChild(n.stateNode)
                    } catch (u) {
                        dt(n, e, u)
                    }
            break;
        case 18:
            mt !== null && (te ? (t = mt,
            Mh(t.nodeType === 9 ? t.body : t.nodeName === "HTML" ? t.ownerDocument.body : t, n.stateNode),
            Ba(t)) : Mh(mt, n.stateNode));
            break;
        case 4:
            l = mt,
            a = te,
            mt = n.stateNode.containerInfo,
            te = !0,
            tn(t, e, n),
            mt = l,
            te = a;
            break;
        case 0:
        case 11:
        case 14:
        case 15:
            Rt || gn(2, n, e),
            Rt || gn(4, n, e),
            tn(t, e, n);
            break;
        case 1:
            Rt || (Ne(n, e),
            l = n.stateNode,
            typeof l.componentWillUnmount == "function" && Df(n, e, l)),
            tn(t, e, n);
            break;
        case 21:
            tn(t, e, n);
            break;
        case 22:
            Rt = (l = Rt) || n.memoizedState !== null,
            tn(t, e, n),
            Rt = l;
            break;
        default:
            tn(t, e, n)
        }
    }
    function jf(t, e) {
        if (e.memoizedState === null && (t = e.alternate,
        t !== null && (t = t.memoizedState,
        t !== null && (t = t.dehydrated,
        t !== null))))
            try {
                Ba(t)
            } catch (n) {
                dt(e, e.return, n)
            }
    }
    function yg(t) {
        switch (t.tag) {
        case 13:
        case 19:
            var e = t.stateNode;
            return e === null && (e = t.stateNode = new Qf),
            e;
        case 22:
            return t = t.stateNode,
            e = t._retryCache,
            e === null && (e = t._retryCache = new Qf),
            e;
        default:
            throw Error(r(435, t.tag))
        }
    }
    function Ks(t, e) {
        var n = yg(t);
        e.forEach(function(l) {
            var a = Eg.bind(null, t, l);
            n.has(l) || (n.add(l),
            l.then(a, a))
        })
    }
    function ce(t, e) {
        var n = e.deletions;
        if (n !== null)
            for (var l = 0; l < n.length; l++) {
                var a = n[l]
                  , u = t
                  , o = e
                  , f = o;
                t: for (; f !== null; ) {
                    switch (f.tag) {
                    case 27:
                        if (En(f.type)) {
                            mt = f.stateNode,
                            te = !1;
                            break t
                        }
                        break;
                    case 5:
                        mt = f.stateNode,
                        te = !1;
                        break t;
                    case 3:
                    case 4:
                        mt = f.stateNode.containerInfo,
                        te = !0;
                        break t
                    }
                    f = f.return
                }
                if (mt === null)
                    throw Error(r(160));
                Lf(u, o, a),
                mt = null,
                te = !1,
                u = a.alternate,
                u !== null && (u.return = null),
                a.return = null
            }
        if (e.subtreeFlags & 13878)
            for (e = e.child; e !== null; )
                Vf(e, t),
                e = e.sibling
    }
    var Me = null;
    function Vf(t, e) {
        var n = t.alternate
          , l = t.flags;
        switch (t.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
            ce(e, t),
            re(t),
            l & 4 && (gn(3, t, t.return),
            ba(3, t),
            gn(5, t, t.return));
            break;
        case 1:
            ce(e, t),
            re(t),
            l & 512 && (Rt || n === null || Ne(n, n.return)),
            l & 64 && Pe && (t = t.updateQueue,
            t !== null && (l = t.callbacks,
            l !== null && (n = t.shared.hiddenCallbacks,
            t.shared.hiddenCallbacks = n === null ? l : n.concat(l))));
            break;
        case 26:
            var a = Me;
            if (ce(e, t),
            re(t),
            l & 512 && (Rt || n === null || Ne(n, n.return)),
            l & 4) {
                var u = n !== null ? n.memoizedState : null;
                if (l = t.memoizedState,
                n === null)
                    if (l === null)
                        if (t.stateNode === null) {
                            t: {
                                l = t.type,
                                n = t.memoizedProps,
                                a = a.ownerDocument || a;
                                e: switch (l) {
                                case "title":
                                    u = a.getElementsByTagName("title")[0],
                                    (!u || u[Xl] || u[Yt] || u.namespaceURI === "http://www.w3.org/2000/svg" || u.hasAttribute("itemprop")) && (u = a.createElement(l),
                                    a.head.insertBefore(u, a.querySelector("head > title"))),
                                    jt(u, l, n),
                                    u[Yt] = t,
                                    Dt(u),
                                    l = u;
                                    break t;
                                case "link":
                                    var o = Nh("link", "href", a).get(l + (n.href || ""));
                                    if (o) {
                                        for (var f = 0; f < o.length; f++)
                                            if (u = o[f],
                                            u.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && u.getAttribute("rel") === (n.rel == null ? null : n.rel) && u.getAttribute("title") === (n.title == null ? null : n.title) && u.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
                                                o.splice(f, 1);
                                                break e
                                            }
                                    }
                                    u = a.createElement(l),
                                    jt(u, l, n),
                                    a.head.appendChild(u);
                                    break;
                                case "meta":
                                    if (o = Nh("meta", "content", a).get(l + (n.content || ""))) {
                                        for (f = 0; f < o.length; f++)
                                            if (u = o[f],
                                            u.getAttribute("content") === (n.content == null ? null : "" + n.content) && u.getAttribute("name") === (n.name == null ? null : n.name) && u.getAttribute("property") === (n.property == null ? null : n.property) && u.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && u.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
                                                o.splice(f, 1);
                                                break e
                                            }
                                    }
                                    u = a.createElement(l),
                                    jt(u, l, n),
                                    a.head.appendChild(u);
                                    break;
                                default:
                                    throw Error(r(468, l))
                                }
                                u[Yt] = t,
                                Dt(u),
                                l = u
                            }
                            t.stateNode = l
                        } else
                            Qh(a, t.type, t.stateNode);
                    else
                        t.stateNode = Uh(a, l, t.memoizedProps);
                else
                    u !== l ? (u === null ? n.stateNode !== null && (n = n.stateNode,
                    n.parentNode.removeChild(n)) : u.count--,
                    l === null ? Qh(a, t.type, t.stateNode) : Uh(a, l, t.memoizedProps)) : l === null && t.stateNode !== null && Gs(t, t.memoizedProps, n.memoizedProps)
            }
            break;
        case 27:
            ce(e, t),
            re(t),
            l & 512 && (Rt || n === null || Ne(n, n.return)),
            n !== null && l & 4 && Gs(t, t.memoizedProps, n.memoizedProps);
            break;
        case 5:
            if (ce(e, t),
            re(t),
            l & 512 && (Rt || n === null || Ne(n, n.return)),
            t.flags & 32) {
                a = t.stateNode;
                try {
                    il(a, "")
                } catch (R) {
                    dt(t, t.return, R)
                }
            }
            l & 4 && t.stateNode != null && (a = t.memoizedProps,
            Gs(t, a, n !== null ? n.memoizedProps : a)),
            l & 1024 && (Zs = !0);
            break;
        case 6:
            if (ce(e, t),
            re(t),
            l & 4) {
                if (t.stateNode === null)
                    throw Error(r(162));
                l = t.memoizedProps,
                n = t.stateNode;
                try {
                    n.nodeValue = l
                } catch (R) {
                    dt(t, t.return, R)
                }
            }
            break;
        case 3:
            if (Iu = null,
            a = Me,
            Me = Wu(e.containerInfo),
            ce(e, t),
            Me = a,
            re(t),
            l & 4 && n !== null && n.memoizedState.isDehydrated)
                try {
                    Ba(e.containerInfo)
                } catch (R) {
                    dt(t, t.return, R)
                }
            Zs && (Zs = !1,
            Yf(t));
            break;
        case 4:
            l = Me,
            Me = Wu(t.stateNode.containerInfo),
            ce(e, t),
            re(t),
            Me = l;
            break;
        case 12:
            ce(e, t),
            re(t);
            break;
        case 13:
            ce(e, t),
            re(t),
            t.child.flags & 8192 && t.memoizedState !== null != (n !== null && n.memoizedState !== null) && (Ps = De()),
            l & 4 && (l = t.updateQueue,
            l !== null && (t.updateQueue = null,
            Ks(t, l)));
            break;
        case 22:
            a = t.memoizedState !== null;
            var d = n !== null && n.memoizedState !== null
              , p = Pe
              , O = Rt;
            if (Pe = p || a,
            Rt = O || d,
            ce(e, t),
            Rt = O,
            Pe = p,
            re(t),
            l & 8192)
                t: for (e = t.stateNode,
                e._visibility = a ? e._visibility & -2 : e._visibility | 1,
                a && (n === null || d || Pe || Rt || Zn(t)),
                n = null,
                e = t; ; ) {
                    if (e.tag === 5 || e.tag === 26) {
                        if (n === null) {
                            d = n = e;
                            try {
                                if (u = d.stateNode,
                                a)
                                    o = u.style,
                                    typeof o.setProperty == "function" ? o.setProperty("display", "none", "important") : o.display = "none";
                                else {
                                    f = d.stateNode;
                                    var w = d.memoizedProps.style
                                      , A = w != null && w.hasOwnProperty("display") ? w.display : null;
                                    f.style.display = A == null || typeof A == "boolean" ? "" : ("" + A).trim()
                                }
                            } catch (R) {
                                dt(d, d.return, R)
                            }
                        }
                    } else if (e.tag === 6) {
                        if (n === null) {
                            d = e;
                            try {
                                d.stateNode.nodeValue = a ? "" : d.memoizedProps
                            } catch (R) {
                                dt(d, d.return, R)
                            }
                        }
                    } else if ((e.tag !== 22 && e.tag !== 23 || e.memoizedState === null || e === t) && e.child !== null) {
                        e.child.return = e,
                        e = e.child;
                        continue
                    }
                    if (e === t)
                        break t;
                    for (; e.sibling === null; ) {
                        if (e.return === null || e.return === t)
                            break t;
                        n === e && (n = null),
                        e = e.return
                    }
                    n === e && (n = null),
                    e.sibling.return = e.return,
                    e = e.sibling
                }
            l & 4 && (l = t.updateQueue,
            l !== null && (n = l.retryQueue,
            n !== null && (l.retryQueue = null,
            Ks(t, n))));
            break;
        case 19:
            ce(e, t),
            re(t),
            l & 4 && (l = t.updateQueue,
            l !== null && (t.updateQueue = null,
            Ks(t, l)));
            break;
        case 30:
            break;
        case 21:
            break;
        default:
            ce(e, t),
            re(t)
        }
    }
    function re(t) {
        var e = t.flags;
        if (e & 2) {
            try {
                for (var n, l = t.return; l !== null; ) {
                    if (Uf(l)) {
                        n = l;
                        break
                    }
                    l = l.return
                }
                if (n == null)
                    throw Error(r(160));
                switch (n.tag) {
                case 27:
                    var a = n.stateNode
                      , u = Xs(t);
                    Bu(t, u, a);
                    break;
                case 5:
                    var o = n.stateNode;
                    n.flags & 32 && (il(o, ""),
                    n.flags &= -33);
                    var f = Xs(t);
                    Bu(t, f, o);
                    break;
                case 3:
                case 4:
                    var d = n.stateNode.containerInfo
                      , p = Xs(t);
                    ks(t, p, d);
                    break;
                default:
                    throw Error(r(161))
                }
            } catch (O) {
                dt(t, t.return, O)
            }
            t.flags &= -3
        }
        e & 4096 && (t.flags &= -4097)
    }
    function Yf(t) {
        if (t.subtreeFlags & 1024)
            for (t = t.child; t !== null; ) {
                var e = t;
                Yf(e),
                e.tag === 5 && e.flags & 1024 && e.stateNode.reset(),
                t = t.sibling
            }
    }
    function vn(t, e) {
        if (e.subtreeFlags & 8772)
            for (e = e.child; e !== null; )
                Bf(t, e.alternate, e),
                e = e.sibling
    }
    function Zn(t) {
        for (t = t.child; t !== null; ) {
            var e = t;
            switch (e.tag) {
            case 0:
            case 11:
            case 14:
            case 15:
                gn(4, e, e.return),
                Zn(e);
                break;
            case 1:
                Ne(e, e.return);
                var n = e.stateNode;
                typeof n.componentWillUnmount == "function" && Df(e, e.return, n),
                Zn(e);
                break;
            case 27:
                qa(e.stateNode);
            case 26:
            case 5:
                Ne(e, e.return),
                Zn(e);
                break;
            case 22:
                e.memoizedState === null && Zn(e);
                break;
            case 30:
                Zn(e);
                break;
            default:
                Zn(e)
            }
            t = t.sibling
        }
    }
    function mn(t, e, n) {
        for (n = n && (e.subtreeFlags & 8772) !== 0,
        e = e.child; e !== null; ) {
            var l = e.alternate
              , a = t
              , u = e
              , o = u.flags;
            switch (u.tag) {
            case 0:
            case 11:
            case 15:
                mn(a, u, n),
                ba(4, u);
                break;
            case 1:
                if (mn(a, u, n),
                l = u,
                a = l.stateNode,
                typeof a.componentDidMount == "function")
                    try {
                        a.componentDidMount()
                    } catch (p) {
                        dt(l, l.return, p)
                    }
                if (l = u,
                a = l.updateQueue,
                a !== null) {
                    var f = l.stateNode;
                    try {
                        var d = a.shared.hiddenCallbacks;
                        if (d !== null)
                            for (a.shared.hiddenCallbacks = null,
                            a = 0; a < d.length; a++)
                                vo(d[a], f)
                    } catch (p) {
                        dt(l, l.return, p)
                    }
                }
                n && o & 64 && Cf(u),
                pa(u, u.return);
                break;
            case 27:
                Nf(u);
            case 26:
            case 5:
                mn(a, u, n),
                n && l === null && o & 4 && zf(u),
                pa(u, u.return);
                break;
            case 12:
                mn(a, u, n);
                break;
            case 13:
                mn(a, u, n),
                n && o & 4 && jf(a, u);
                break;
            case 22:
                u.memoizedState === null && mn(a, u, n),
                pa(u, u.return);
                break;
            case 30:
                break;
            default:
                mn(a, u, n)
            }
            e = e.sibling
        }
    }
    function Js(t, e) {
        var n = null;
        t !== null && t.memoizedState !== null && t.memoizedState.cachePool !== null && (n = t.memoizedState.cachePool.pool),
        t = null,
        e.memoizedState !== null && e.memoizedState.cachePool !== null && (t = e.memoizedState.cachePool.pool),
        t !== n && (t != null && t.refCount++,
        n != null && ua(n))
    }
    function $s(t, e) {
        t = null,
        e.alternate !== null && (t = e.alternate.memoizedState.cache),
        e = e.memoizedState.cache,
        e !== t && (e.refCount++,
        t != null && ua(t))
    }
    function Qe(t, e, n, l) {
        if (e.subtreeFlags & 10256)
            for (e = e.child; e !== null; )
                Gf(t, e, n, l),
                e = e.sibling
    }
    function Gf(t, e, n, l) {
        var a = e.flags;
        switch (e.tag) {
        case 0:
        case 11:
        case 15:
            Qe(t, e, n, l),
            a & 2048 && ba(9, e);
            break;
        case 1:
            Qe(t, e, n, l);
            break;
        case 3:
            Qe(t, e, n, l),
            a & 2048 && (t = null,
            e.alternate !== null && (t = e.alternate.memoizedState.cache),
            e = e.memoizedState.cache,
            e !== t && (e.refCount++,
            t != null && ua(t)));
            break;
        case 12:
            if (a & 2048) {
                Qe(t, e, n, l),
                t = e.stateNode;
                try {
                    var u = e.memoizedProps
                      , o = u.id
                      , f = u.onPostCommit;
                    typeof f == "function" && f(o, e.alternate === null ? "mount" : "update", t.passiveEffectDuration, -0)
                } catch (d) {
                    dt(e, e.return, d)
                }
            } else
                Qe(t, e, n, l);
            break;
        case 13:
            Qe(t, e, n, l);
            break;
        case 23:
            break;
        case 22:
            u = e.stateNode,
            o = e.alternate,
            e.memoizedState !== null ? u._visibility & 2 ? Qe(t, e, n, l) : Ta(t, e) : u._visibility & 2 ? Qe(t, e, n, l) : (u._visibility |= 2,
            Rl(t, e, n, l, (e.subtreeFlags & 10256) !== 0)),
            a & 2048 && Js(o, e);
            break;
        case 24:
            Qe(t, e, n, l),
            a & 2048 && $s(e.alternate, e);
            break;
        default:
            Qe(t, e, n, l)
        }
    }
    function Rl(t, e, n, l, a) {
        for (a = a && (e.subtreeFlags & 10256) !== 0,
        e = e.child; e !== null; ) {
            var u = t
              , o = e
              , f = n
              , d = l
              , p = o.flags;
            switch (o.tag) {
            case 0:
            case 11:
            case 15:
                Rl(u, o, f, d, a),
                ba(8, o);
                break;
            case 23:
                break;
            case 22:
                var O = o.stateNode;
                o.memoizedState !== null ? O._visibility & 2 ? Rl(u, o, f, d, a) : Ta(u, o) : (O._visibility |= 2,
                Rl(u, o, f, d, a)),
                a && p & 2048 && Js(o.alternate, o);
                break;
            case 24:
                Rl(u, o, f, d, a),
                a && p & 2048 && $s(o.alternate, o);
                break;
            default:
                Rl(u, o, f, d, a)
            }
            e = e.sibling
        }
    }
    function Ta(t, e) {
        if (e.subtreeFlags & 10256)
            for (e = e.child; e !== null; ) {
                var n = t
                  , l = e
                  , a = l.flags;
                switch (l.tag) {
                case 22:
                    Ta(n, l),
                    a & 2048 && Js(l.alternate, l);
                    break;
                case 24:
                    Ta(n, l),
                    a & 2048 && $s(l.alternate, l);
                    break;
                default:
                    Ta(n, l)
                }
                e = e.sibling
            }
    }
    var Aa = 8192;
    function Ol(t) {
        if (t.subtreeFlags & Aa)
            for (t = t.child; t !== null; )
                Xf(t),
                t = t.sibling
    }
    function Xf(t) {
        switch (t.tag) {
        case 26:
            Ol(t),
            t.flags & Aa && t.memoizedState !== null && Pg(Me, t.memoizedState, t.memoizedProps);
            break;
        case 5:
            Ol(t);
            break;
        case 3:
        case 4:
            var e = Me;
            Me = Wu(t.stateNode.containerInfo),
            Ol(t),
            Me = e;
            break;
        case 22:
            t.memoizedState === null && (e = t.alternate,
            e !== null && e.memoizedState !== null ? (e = Aa,
            Aa = 16777216,
            Ol(t),
            Aa = e) : Ol(t));
            break;
        default:
            Ol(t)
        }
    }
    function kf(t) {
        var e = t.alternate;
        if (e !== null && (t = e.child,
        t !== null)) {
            e.child = null;
            do
                e = t.sibling,
                t.sibling = null,
                t = e;
            while (t !== null)
        }
    }
    function Ea(t) {
        var e = t.deletions;
        if ((t.flags & 16) !== 0) {
            if (e !== null)
                for (var n = 0; n < e.length; n++) {
                    var l = e[n];
                    Ut = l,
                    Kf(l, t)
                }
            kf(t)
        }
        if (t.subtreeFlags & 10256)
            for (t = t.child; t !== null; )
                Zf(t),
                t = t.sibling
    }
    function Zf(t) {
        switch (t.tag) {
        case 0:
        case 11:
        case 15:
            Ea(t),
            t.flags & 2048 && gn(9, t, t.return);
            break;
        case 3:
            Ea(t);
            break;
        case 12:
            Ea(t);
            break;
        case 22:
            var e = t.stateNode;
            t.memoizedState !== null && e._visibility & 2 && (t.return === null || t.return.tag !== 13) ? (e._visibility &= -3,
            Hu(t)) : Ea(t);
            break;
        default:
            Ea(t)
        }
    }
    function Hu(t) {
        var e = t.deletions;
        if ((t.flags & 16) !== 0) {
            if (e !== null)
                for (var n = 0; n < e.length; n++) {
                    var l = e[n];
                    Ut = l,
                    Kf(l, t)
                }
            kf(t)
        }
        for (t = t.child; t !== null; ) {
            switch (e = t,
            e.tag) {
            case 0:
            case 11:
            case 15:
                gn(8, e, e.return),
                Hu(e);
                break;
            case 22:
                n = e.stateNode,
                n._visibility & 2 && (n._visibility &= -3,
                Hu(e));
                break;
            default:
                Hu(e)
            }
            t = t.sibling
        }
    }
    function Kf(t, e) {
        for (; Ut !== null; ) {
            var n = Ut;
            switch (n.tag) {
            case 0:
            case 11:
            case 15:
                gn(8, n, e);
                break;
            case 23:
            case 22:
                if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
                    var l = n.memoizedState.cachePool.pool;
                    l != null && l.refCount++
                }
                break;
            case 24:
                ua(n.memoizedState.cache)
            }
            if (l = n.child,
            l !== null)
                l.return = n,
                Ut = l;
            else
                t: for (n = t; Ut !== null; ) {
                    l = Ut;
                    var a = l.sibling
                      , u = l.return;
                    if (Hf(l),
                    l === n) {
                        Ut = null;
                        break t
                    }
                    if (a !== null) {
                        a.return = u,
                        Ut = a;
                        break t
                    }
                    Ut = u
                }
        }
    }
    var gg = {
        getCacheForType: function(t) {
            var e = Gt(qt)
              , n = e.data.get(t);
            return n === void 0 && (n = t(),
            e.data.set(t, n)),
            n
        }
    }
      , vg = typeof WeakMap == "function" ? WeakMap : Map
      , ct = 0
      , gt = null
      , nt = null
      , at = 0
      , rt = 0
      , oe = null
      , Sn = !1
      , Ml = !1
      , Ws = !1
      , en = 0
      , Et = 0
      , bn = 0
      , Kn = 0
      , Fs = 0
      , Te = 0
      , wl = 0
      , _a = null
      , ee = null
      , Is = !1
      , Ps = 0
      , Lu = 1 / 0
      , ju = null
      , pn = null
      , Lt = 0
      , Tn = null
      , ql = null
      , xl = 0
      , tc = 0
      , ec = null
      , Jf = null
      , Ra = 0
      , nc = null;
    function fe() {
        if ((ct & 2) !== 0 && at !== 0)
            return at & -at;
        if (_.T !== null) {
            var t = ml;
            return t !== 0 ? t : rc()
        }
        return cr()
    }
    function $f() {
        Te === 0 && (Te = (at & 536870912) === 0 || st ? ar() : 536870912);
        var t = pe.current;
        return t !== null && (t.flags |= 32),
        Te
    }
    function he(t, e, n) {
        (t === gt && (rt === 2 || rt === 9) || t.cancelPendingCommit !== null) && (Cl(t, 0),
        An(t, at, Te, !1)),
        Gl(t, n),
        ((ct & 2) === 0 || t !== gt) && (t === gt && ((ct & 2) === 0 && (Kn |= n),
        Et === 4 && An(t, at, Te, !1)),
        Be(t))
    }
    function Wf(t, e, n) {
        if ((ct & 6) !== 0)
            throw Error(r(327));
        var l = !n && (e & 124) === 0 && (e & t.expiredLanes) === 0 || Yl(t, e)
          , a = l ? bg(t, e) : uc(t, e, !0)
          , u = l;
        do {
            if (a === 0) {
                Ml && !l && An(t, e, 0, !1);
                break
            } else {
                if (n = t.current.alternate,
                u && !mg(n)) {
                    a = uc(t, e, !1),
                    u = !1;
                    continue
                }
                if (a === 2) {
                    if (u = e,
                    t.errorRecoveryDisabledLanes & u)
                        var o = 0;
                    else
                        o = t.pendingLanes & -536870913,
                        o = o !== 0 ? o : o & 536870912 ? 536870912 : 0;
                    if (o !== 0) {
                        e = o;
                        t: {
                            var f = t;
                            a = _a;
                            var d = f.current.memoizedState.isDehydrated;
                            if (d && (Cl(f, o).flags |= 256),
                            o = uc(f, o, !1),
                            o !== 2) {
                                if (Ws && !d) {
                                    f.errorRecoveryDisabledLanes |= u,
                                    Kn |= u,
                                    a = 4;
                                    break t
                                }
                                u = ee,
                                ee = a,
                                u !== null && (ee === null ? ee = u : ee.push.apply(ee, u))
                            }
                            a = o
                        }
                        if (u = !1,
                        a !== 2)
                            continue
                    }
                }
                if (a === 1) {
                    Cl(t, 0),
                    An(t, e, 0, !0);
                    break
                }
                t: {
                    switch (l = t,
                    u = a,
                    u) {
                    case 0:
                    case 1:
                        throw Error(r(345));
                    case 4:
                        if ((e & 4194048) !== e)
                            break;
                    case 6:
                        An(l, e, Te, !Sn);
                        break t;
                    case 2:
                        ee = null;
                        break;
                    case 3:
                    case 5:
                        break;
                    default:
                        throw Error(r(329))
                    }
                    if ((e & 62914560) === e && (a = Ps + 300 - De(),
                    10 < a)) {
                        if (An(l, e, Te, !Sn),
                        Fa(l, 0, !0) !== 0)
                            break t;
                        l.timeoutHandle = Rh(Ff.bind(null, l, n, ee, ju, Is, e, Te, Kn, wl, Sn, u, 2, -0, 0), a);
                        break t
                    }
                    Ff(l, n, ee, ju, Is, e, Te, Kn, wl, Sn, u, 0, -0, 0)
                }
            }
            break
        } while (!0);
        Be(t)
    }
    function Ff(t, e, n, l, a, u, o, f, d, p, O, w, A, R) {
        if (t.timeoutHandle = -1,
        w = e.subtreeFlags,
        (w & 8192 || (w & 16785408) === 16785408) && (Da = {
            stylesheets: null,
            count: 0,
            unsuspend: Ig
        },
        Xf(e),
        w = tv(),
        w !== null)) {
            t.cancelPendingCommit = w(ah.bind(null, t, e, u, n, l, a, o, f, d, O, 1, A, R)),
            An(t, u, o, !p);
            return
        }
        ah(t, e, u, n, l, a, o, f, d)
    }
    function mg(t) {
        for (var e = t; ; ) {
            var n = e.tag;
            if ((n === 0 || n === 11 || n === 15) && e.flags & 16384 && (n = e.updateQueue,
            n !== null && (n = n.stores,
            n !== null)))
                for (var l = 0; l < n.length; l++) {
                    var a = n[l]
                      , u = a.getSnapshot;
                    a = a.value;
                    try {
                        if (!ie(u(), a))
                            return !1
                    } catch {
                        return !1
                    }
                }
            if (n = e.child,
            e.subtreeFlags & 16384 && n !== null)
                n.return = e,
                e = n;
            else {
                if (e === t)
                    break;
                for (; e.sibling === null; ) {
                    if (e.return === null || e.return === t)
                        return !0;
                    e = e.return
                }
                e.sibling.return = e.return,
                e = e.sibling
            }
        }
        return !0
    }
    function An(t, e, n, l) {
        e &= ~Fs,
        e &= ~Kn,
        t.suspendedLanes |= e,
        t.pingedLanes &= ~e,
        l && (t.warmLanes |= e),
        l = t.expirationTimes;
        for (var a = e; 0 < a; ) {
            var u = 31 - ue(a)
              , o = 1 << u;
            l[u] = -1,
            a &= ~o
        }
        n !== 0 && ir(t, n, e)
    }
    function Vu() {
        return (ct & 6) === 0 ? (Oa(0),
        !1) : !0
    }
    function lc() {
        if (nt !== null) {
            if (rt === 0)
                var t = nt.return;
            else
                t = nt,
                Ke = Vn = null,
                ps(t),
                El = null,
                va = 0,
                t = nt;
            for (; t !== null; )
                xf(t.alternate, t),
                t = t.return;
            nt = null
        }
    }
    function Cl(t, e) {
        var n = t.timeoutHandle;
        n !== -1 && (t.timeoutHandle = -1,
        Ng(n)),
        n = t.cancelPendingCommit,
        n !== null && (t.cancelPendingCommit = null,
        n()),
        lc(),
        gt = t,
        nt = n = Xe(t.current, null),
        at = e,
        rt = 0,
        oe = null,
        Sn = !1,
        Ml = Yl(t, e),
        Ws = !1,
        wl = Te = Fs = Kn = bn = Et = 0,
        ee = _a = null,
        Is = !1,
        (e & 8) !== 0 && (e |= e & 32);
        var l = t.entangledLanes;
        if (l !== 0)
            for (t = t.entanglements,
            l &= e; 0 < l; ) {
                var a = 31 - ue(l)
                  , u = 1 << a;
                e |= t[a],
                l &= ~u
            }
        return en = e,
        ru(),
        n
    }
    function If(t, e) {
        P = null,
        _.H = wu,
        e === sa || e === Su ? (e = yo(),
        rt = 3) : e === oo ? (e = yo(),
        rt = 4) : rt = e === vf ? 8 : e !== null && typeof e == "object" && typeof e.then == "function" ? 6 : 1,
        oe = e,
        nt === null && (Et = 1,
        zu(t, ve(e, t.current)))
    }
    function Pf() {
        var t = _.H;
        return _.H = wu,
        t === null ? wu : t
    }
    function th() {
        var t = _.A;
        return _.A = gg,
        t
    }
    function ac() {
        Et = 4,
        Sn || (at & 4194048) !== at && pe.current !== null || (Ml = !0),
        (bn & 134217727) === 0 && (Kn & 134217727) === 0 || gt === null || An(gt, at, Te, !1)
    }
    function uc(t, e, n) {
        var l = ct;
        ct |= 2;
        var a = Pf()
          , u = th();
        (gt !== t || at !== e) && (ju = null,
        Cl(t, e)),
        e = !1;
        var o = Et;
        t: do
            try {
                if (rt !== 0 && nt !== null) {
                    var f = nt
                      , d = oe;
                    switch (rt) {
                    case 8:
                        lc(),
                        o = 6;
                        break t;
                    case 3:
                    case 2:
                    case 9:
                    case 6:
                        pe.current === null && (e = !0);
                        var p = rt;
                        if (rt = 0,
                        oe = null,
                        Dl(t, f, d, p),
                        n && Ml) {
                            o = 0;
                            break t
                        }
                        break;
                    default:
                        p = rt,
                        rt = 0,
                        oe = null,
                        Dl(t, f, d, p)
                    }
                }
                Sg(),
                o = Et;
                break
            } catch (O) {
                If(t, O)
            }
        while (!0);
        return e && t.shellSuspendCounter++,
        Ke = Vn = null,
        ct = l,
        _.H = a,
        _.A = u,
        nt === null && (gt = null,
        at = 0,
        ru()),
        o
    }
    function Sg() {
        for (; nt !== null; )
            eh(nt)
    }
    function bg(t, e) {
        var n = ct;
        ct |= 2;
        var l = Pf()
          , a = th();
        gt !== t || at !== e ? (ju = null,
        Lu = De() + 500,
        Cl(t, e)) : Ml = Yl(t, e);
        t: do
            try {
                if (rt !== 0 && nt !== null) {
                    e = nt;
                    var u = oe;
                    e: switch (rt) {
                    case 1:
                        rt = 0,
                        oe = null,
                        Dl(t, e, u, 1);
                        break;
                    case 2:
                    case 9:
                        if (fo(u)) {
                            rt = 0,
                            oe = null,
                            nh(e);
                            break
                        }
                        e = function() {
                            rt !== 2 && rt !== 9 || gt !== t || (rt = 7),
                            Be(t)
                        }
                        ,
                        u.then(e, e);
                        break t;
                    case 3:
                        rt = 7;
                        break t;
                    case 4:
                        rt = 5;
                        break t;
                    case 7:
                        fo(u) ? (rt = 0,
                        oe = null,
                        nh(e)) : (rt = 0,
                        oe = null,
                        Dl(t, e, u, 7));
                        break;
                    case 5:
                        var o = null;
                        switch (nt.tag) {
                        case 26:
                            o = nt.memoizedState;
                        case 5:
                        case 27:
                            var f = nt;
                            if (!o || Bh(o)) {
                                rt = 0,
                                oe = null;
                                var d = f.sibling;
                                if (d !== null)
                                    nt = d;
                                else {
                                    var p = f.return;
                                    p !== null ? (nt = p,
                                    Yu(p)) : nt = null
                                }
                                break e
                            }
                        }
                        rt = 0,
                        oe = null,
                        Dl(t, e, u, 5);
                        break;
                    case 6:
                        rt = 0,
                        oe = null,
                        Dl(t, e, u, 6);
                        break;
                    case 8:
                        lc(),
                        Et = 6;
                        break t;
                    default:
                        throw Error(r(462))
                    }
                }
                pg();
                break
            } catch (O) {
                If(t, O)
            }
        while (!0);
        return Ke = Vn = null,
        _.H = l,
        _.A = a,
        ct = n,
        nt !== null ? 0 : (gt = null,
        at = 0,
        ru(),
        Et)
    }
    function pg() {
        for (; nt !== null && !Yd(); )
            eh(nt)
    }
    function eh(t) {
        var e = wf(t.alternate, t, en);
        t.memoizedProps = t.pendingProps,
        e === null ? Yu(t) : nt = e
    }
    function nh(t) {
        var e = t
          , n = e.alternate;
        switch (e.tag) {
        case 15:
        case 0:
            e = Af(n, e, e.pendingProps, e.type, void 0, at);
            break;
        case 11:
            e = Af(n, e, e.pendingProps, e.type.render, e.ref, at);
            break;
        case 5:
            ps(e);
        default:
            xf(n, e),
            e = nt = eo(e, en),
            e = wf(n, e, en)
        }
        t.memoizedProps = t.pendingProps,
        e === null ? Yu(t) : nt = e
    }
    function Dl(t, e, n, l) {
        Ke = Vn = null,
        ps(e),
        El = null,
        va = 0;
        var a = e.return;
        try {
            if (rg(t, a, e, n, at)) {
                Et = 1,
                zu(t, ve(n, t.current)),
                nt = null;
                return
            }
        } catch (u) {
            if (a !== null)
                throw nt = a,
                u;
            Et = 1,
            zu(t, ve(n, t.current)),
            nt = null;
            return
        }
        e.flags & 32768 ? (st || l === 1 ? t = !0 : Ml || (at & 536870912) !== 0 ? t = !1 : (Sn = t = !0,
        (l === 2 || l === 9 || l === 3 || l === 6) && (l = pe.current,
        l !== null && l.tag === 13 && (l.flags |= 16384))),
        lh(e, t)) : Yu(e)
    }
    function Yu(t) {
        var e = t;
        do {
            if ((e.flags & 32768) !== 0) {
                lh(e, Sn);
                return
            }
            t = e.return;
            var n = fg(e.alternate, e, en);
            if (n !== null) {
                nt = n;
                return
            }
            if (e = e.sibling,
            e !== null) {
                nt = e;
                return
            }
            nt = e = t
        } while (e !== null);
        Et === 0 && (Et = 5)
    }
    function lh(t, e) {
        do {
            var n = hg(t.alternate, t);
            if (n !== null) {
                n.flags &= 32767,
                nt = n;
                return
            }
            if (n = t.return,
            n !== null && (n.flags |= 32768,
            n.subtreeFlags = 0,
            n.deletions = null),
            !e && (t = t.sibling,
            t !== null)) {
                nt = t;
                return
            }
            nt = t = n
        } while (t !== null);
        Et = 6,
        nt = null
    }
    function ah(t, e, n, l, a, u, o, f, d) {
        t.cancelPendingCommit = null;
        do
            Gu();
        while (Lt !== 0);
        if ((ct & 6) !== 0)
            throw Error(r(327));
        if (e !== null) {
            if (e === t.current)
                throw Error(r(177));
            if (u = e.lanes | e.childLanes,
            u |= $i,
            Id(t, n, u, o, f, d),
            t === gt && (nt = gt = null,
            at = 0),
            ql = e,
            Tn = t,
            xl = n,
            tc = u,
            ec = a,
            Jf = l,
            (e.subtreeFlags & 10256) !== 0 || (e.flags & 10256) !== 0 ? (t.callbackNode = null,
            t.callbackPriority = 0,
            _g(Ja, function() {
                return rh(),
                null
            })) : (t.callbackNode = null,
            t.callbackPriority = 0),
            l = (e.flags & 13878) !== 0,
            (e.subtreeFlags & 13878) !== 0 || l) {
                l = _.T,
                _.T = null,
                a = C.p,
                C.p = 2,
                o = ct,
                ct |= 4;
                try {
                    dg(t, e, n)
                } finally {
                    ct = o,
                    C.p = a,
                    _.T = l
                }
            }
            Lt = 1,
            uh(),
            ih(),
            sh()
        }
    }
    function uh() {
        if (Lt === 1) {
            Lt = 0;
            var t = Tn
              , e = ql
              , n = (e.flags & 13878) !== 0;
            if ((e.subtreeFlags & 13878) !== 0 || n) {
                n = _.T,
                _.T = null;
                var l = C.p;
                C.p = 2;
                var a = ct;
                ct |= 4;
                try {
                    Vf(e, t);
                    var u = mc
                      , o = kr(t.containerInfo)
                      , f = u.focusedElem
                      , d = u.selectionRange;
                    if (o !== f && f && f.ownerDocument && Xr(f.ownerDocument.documentElement, f)) {
                        if (d !== null && Xi(f)) {
                            var p = d.start
                              , O = d.end;
                            if (O === void 0 && (O = p),
                            "selectionStart"in f)
                                f.selectionStart = p,
                                f.selectionEnd = Math.min(O, f.value.length);
                            else {
                                var w = f.ownerDocument || document
                                  , A = w && w.defaultView || window;
                                if (A.getSelection) {
                                    var R = A.getSelection()
                                      , k = f.textContent.length
                                      , V = Math.min(d.start, k)
                                      , ht = d.end === void 0 ? V : Math.min(d.end, k);
                                    !R.extend && V > ht && (o = ht,
                                    ht = V,
                                    V = o);
                                    var m = Gr(f, V)
                                      , v = Gr(f, ht);
                                    if (m && v && (R.rangeCount !== 1 || R.anchorNode !== m.node || R.anchorOffset !== m.offset || R.focusNode !== v.node || R.focusOffset !== v.offset)) {
                                        var S = w.createRange();
                                        S.setStart(m.node, m.offset),
                                        R.removeAllRanges(),
                                        V > ht ? (R.addRange(S),
                                        R.extend(v.node, v.offset)) : (S.setEnd(v.node, v.offset),
                                        R.addRange(S))
                                    }
                                }
                            }
                        }
                        for (w = [],
                        R = f; R = R.parentNode; )
                            R.nodeType === 1 && w.push({
                                element: R,
                                left: R.scrollLeft,
                                top: R.scrollTop
                            });
                        for (typeof f.focus == "function" && f.focus(),
                        f = 0; f < w.length; f++) {
                            var M = w[f];
                            M.element.scrollLeft = M.left,
                            M.element.scrollTop = M.top
                        }
                    }
                    ei = !!vc,
                    mc = vc = null
                } finally {
                    ct = a,
                    C.p = l,
                    _.T = n
                }
            }
            t.current = e,
            Lt = 2
        }
    }
    function ih() {
        if (Lt === 2) {
            Lt = 0;
            var t = Tn
              , e = ql
              , n = (e.flags & 8772) !== 0;
            if ((e.subtreeFlags & 8772) !== 0 || n) {
                n = _.T,
                _.T = null;
                var l = C.p;
                C.p = 2;
                var a = ct;
                ct |= 4;
                try {
                    Bf(t, e.alternate, e)
                } finally {
                    ct = a,
                    C.p = l,
                    _.T = n
                }
            }
            Lt = 3
        }
    }
    function sh() {
        if (Lt === 4 || Lt === 3) {
            Lt = 0,
            Gd();
            var t = Tn
              , e = ql
              , n = xl
              , l = Jf;
            (e.subtreeFlags & 10256) !== 0 || (e.flags & 10256) !== 0 ? Lt = 5 : (Lt = 0,
            ql = Tn = null,
            ch(t, t.pendingLanes));
            var a = t.pendingLanes;
            if (a === 0 && (pn = null),
            Ei(n),
            e = e.stateNode,
            ae && typeof ae.onCommitFiberRoot == "function")
                try {
                    ae.onCommitFiberRoot(Vl, e, void 0, (e.current.flags & 128) === 128)
                } catch {}
            if (l !== null) {
                e = _.T,
                a = C.p,
                C.p = 2,
                _.T = null;
                try {
                    for (var u = t.onRecoverableError, o = 0; o < l.length; o++) {
                        var f = l[o];
                        u(f.value, {
                            componentStack: f.stack
                        })
                    }
                } finally {
                    _.T = e,
                    C.p = a
                }
            }
            (xl & 3) !== 0 && Gu(),
            Be(t),
            a = t.pendingLanes,
            (n & 4194090) !== 0 && (a & 42) !== 0 ? t === nc ? Ra++ : (Ra = 0,
            nc = t) : Ra = 0,
            Oa(0)
        }
    }
    function ch(t, e) {
        (t.pooledCacheLanes &= e) === 0 && (e = t.pooledCache,
        e != null && (t.pooledCache = null,
        ua(e)))
    }
    function Gu(t) {
        return uh(),
        ih(),
        sh(),
        rh()
    }
    function rh() {
        if (Lt !== 5)
            return !1;
        var t = Tn
          , e = tc;
        tc = 0;
        var n = Ei(xl)
          , l = _.T
          , a = C.p;
        try {
            C.p = 32 > n ? 32 : n,
            _.T = null,
            n = ec,
            ec = null;
            var u = Tn
              , o = xl;
            if (Lt = 0,
            ql = Tn = null,
            xl = 0,
            (ct & 6) !== 0)
                throw Error(r(331));
            var f = ct;
            if (ct |= 4,
            Zf(u.current),
            Gf(u, u.current, o, n),
            ct = f,
            Oa(0, !1),
            ae && typeof ae.onPostCommitFiberRoot == "function")
                try {
                    ae.onPostCommitFiberRoot(Vl, u)
                } catch {}
            return !0
        } finally {
            C.p = a,
            _.T = l,
            ch(t, e)
        }
    }
    function oh(t, e, n) {
        e = ve(n, e),
        e = Us(t.stateNode, e, 2),
        t = fn(t, e, 2),
        t !== null && (Gl(t, 2),
        Be(t))
    }
    function dt(t, e, n) {
        if (t.tag === 3)
            oh(t, t, n);
        else
            for (; e !== null; ) {
                if (e.tag === 3) {
                    oh(e, t, n);
                    break
                } else if (e.tag === 1) {
                    var l = e.stateNode;
                    if (typeof e.type.getDerivedStateFromError == "function" || typeof l.componentDidCatch == "function" && (pn === null || !pn.has(l))) {
                        t = ve(n, t),
                        n = yf(2),
                        l = fn(e, n, 2),
                        l !== null && (gf(n, l, e, t),
                        Gl(l, 2),
                        Be(l));
                        break
                    }
                }
                e = e.return
            }
    }
    function ic(t, e, n) {
        var l = t.pingCache;
        if (l === null) {
            l = t.pingCache = new vg;
            var a = new Set;
            l.set(e, a)
        } else
            a = l.get(e),
            a === void 0 && (a = new Set,
            l.set(e, a));
        a.has(n) || (Ws = !0,
        a.add(n),
        t = Tg.bind(null, t, e, n),
        e.then(t, t))
    }
    function Tg(t, e, n) {
        var l = t.pingCache;
        l !== null && l.delete(e),
        t.pingedLanes |= t.suspendedLanes & n,
        t.warmLanes &= ~n,
        gt === t && (at & n) === n && (Et === 4 || Et === 3 && (at & 62914560) === at && 300 > De() - Ps ? (ct & 2) === 0 && Cl(t, 0) : Fs |= n,
        wl === at && (wl = 0)),
        Be(t)
    }
    function fh(t, e) {
        e === 0 && (e = ur()),
        t = dl(t, e),
        t !== null && (Gl(t, e),
        Be(t))
    }
    function Ag(t) {
        var e = t.memoizedState
          , n = 0;
        e !== null && (n = e.retryLane),
        fh(t, n)
    }
    function Eg(t, e) {
        var n = 0;
        switch (t.tag) {
        case 13:
            var l = t.stateNode
              , a = t.memoizedState;
            a !== null && (n = a.retryLane);
            break;
        case 19:
            l = t.stateNode;
            break;
        case 22:
            l = t.stateNode._retryCache;
            break;
        default:
            throw Error(r(314))
        }
        l !== null && l.delete(e),
        fh(t, n)
    }
    function _g(t, e) {
        return bi(t, e)
    }
    var Xu = null
      , zl = null
      , sc = !1
      , ku = !1
      , cc = !1
      , Jn = 0;
    function Be(t) {
        t !== zl && t.next === null && (zl === null ? Xu = zl = t : zl = zl.next = t),
        ku = !0,
        sc || (sc = !0,
        Og())
    }
    function Oa(t, e) {
        if (!cc && ku) {
            cc = !0;
            do
                for (var n = !1, l = Xu; l !== null; ) {
                    if (t !== 0) {
                        var a = l.pendingLanes;
                        if (a === 0)
                            var u = 0;
                        else {
                            var o = l.suspendedLanes
                              , f = l.pingedLanes;
                            u = (1 << 31 - ue(42 | t) + 1) - 1,
                            u &= a & ~(o & ~f),
                            u = u & 201326741 ? u & 201326741 | 1 : u ? u | 2 : 0
                        }
                        u !== 0 && (n = !0,
                        gh(l, u))
                    } else
                        u = at,
                        u = Fa(l, l === gt ? u : 0, l.cancelPendingCommit !== null || l.timeoutHandle !== -1),
                        (u & 3) === 0 || Yl(l, u) || (n = !0,
                        gh(l, u));
                    l = l.next
                }
            while (n);
            cc = !1
        }
    }
    function Rg() {
        hh()
    }
    function hh() {
        ku = sc = !1;
        var t = 0;
        Jn !== 0 && (Ug() && (t = Jn),
        Jn = 0);
        for (var e = De(), n = null, l = Xu; l !== null; ) {
            var a = l.next
              , u = dh(l, e);
            u === 0 ? (l.next = null,
            n === null ? Xu = a : n.next = a,
            a === null && (zl = n)) : (n = l,
            (t !== 0 || (u & 3) !== 0) && (ku = !0)),
            l = a
        }
        Oa(t)
    }
    function dh(t, e) {
        for (var n = t.suspendedLanes, l = t.pingedLanes, a = t.expirationTimes, u = t.pendingLanes & -62914561; 0 < u; ) {
            var o = 31 - ue(u)
              , f = 1 << o
              , d = a[o];
            d === -1 ? ((f & n) === 0 || (f & l) !== 0) && (a[o] = Fd(f, e)) : d <= e && (t.expiredLanes |= f),
            u &= ~f
        }
        if (e = gt,
        n = at,
        n = Fa(t, t === e ? n : 0, t.cancelPendingCommit !== null || t.timeoutHandle !== -1),
        l = t.callbackNode,
        n === 0 || t === e && (rt === 2 || rt === 9) || t.cancelPendingCommit !== null)
            return l !== null && l !== null && pi(l),
            t.callbackNode = null,
            t.callbackPriority = 0;
        if ((n & 3) === 0 || Yl(t, n)) {
            if (e = n & -n,
            e === t.callbackPriority)
                return e;
            switch (l !== null && pi(l),
            Ei(n)) {
            case 2:
            case 8:
                n = nr;
                break;
            case 32:
                n = Ja;
                break;
            case 268435456:
                n = lr;
                break;
            default:
                n = Ja
            }
            return l = yh.bind(null, t),
            n = bi(n, l),
            t.callbackPriority = e,
            t.callbackNode = n,
            e
        }
        return l !== null && l !== null && pi(l),
        t.callbackPriority = 2,
        t.callbackNode = null,
        2
    }
    function yh(t, e) {
        if (Lt !== 0 && Lt !== 5)
            return t.callbackNode = null,
            t.callbackPriority = 0,
            null;
        var n = t.callbackNode;
        if (Gu() && t.callbackNode !== n)
            return null;
        var l = at;
        return l = Fa(t, t === gt ? l : 0, t.cancelPendingCommit !== null || t.timeoutHandle !== -1),
        l === 0 ? null : (Wf(t, l, e),
        dh(t, De()),
        t.callbackNode != null && t.callbackNode === n ? yh.bind(null, t) : null)
    }
    function gh(t, e) {
        if (Gu())
            return null;
        Wf(t, e, !0)
    }
    function Og() {
        Qg(function() {
            (ct & 6) !== 0 ? bi(er, Rg) : hh()
        })
    }
    function rc() {
        return Jn === 0 && (Jn = ar()),
        Jn
    }
    function vh(t) {
        return t == null || typeof t == "symbol" || typeof t == "boolean" ? null : typeof t == "function" ? t : nu("" + t)
    }
    function mh(t, e) {
        var n = e.ownerDocument.createElement("input");
        return n.name = e.name,
        n.value = e.value,
        t.id && n.setAttribute("form", t.id),
        e.parentNode.insertBefore(n, e),
        t = new FormData(t),
        n.parentNode.removeChild(n),
        t
    }
    function Mg(t, e, n, l, a) {
        if (e === "submit" && n && n.stateNode === a) {
            var u = vh((a[Ft] || null).action)
              , o = l.submitter;
            o && (e = (e = o[Ft] || null) ? vh(e.formAction) : o.getAttribute("formAction"),
            e !== null && (u = e,
            o = null));
            var f = new iu("action","action",null,l,a);
            t.push({
                event: f,
                listeners: [{
                    instance: null,
                    listener: function() {
                        if (l.defaultPrevented) {
                            if (Jn !== 0) {
                                var d = o ? mh(a, o) : new FormData(a);
                                qs(n, {
                                    pending: !0,
                                    data: d,
                                    method: a.method,
                                    action: u
                                }, null, d)
                            }
                        } else
                            typeof u == "function" && (f.preventDefault(),
                            d = o ? mh(a, o) : new FormData(a),
                            qs(n, {
                                pending: !0,
                                data: d,
                                method: a.method,
                                action: u
                            }, u, d))
                    },
                    currentTarget: a
                }]
            })
        }
    }
    for (var oc = 0; oc < Ji.length; oc++) {
        var fc = Ji[oc]
          , wg = fc.toLowerCase()
          , qg = fc[0].toUpperCase() + fc.slice(1);
        Oe(wg, "on" + qg)
    }
    Oe(Jr, "onAnimationEnd"),
    Oe($r, "onAnimationIteration"),
    Oe(Wr, "onAnimationStart"),
    Oe("dblclick", "onDoubleClick"),
    Oe("focusin", "onFocus"),
    Oe("focusout", "onBlur"),
    Oe(Zy, "onTransitionRun"),
    Oe(Ky, "onTransitionStart"),
    Oe(Jy, "onTransitionCancel"),
    Oe(Fr, "onTransitionEnd"),
    ll("onMouseEnter", ["mouseout", "mouseover"]),
    ll("onMouseLeave", ["mouseout", "mouseover"]),
    ll("onPointerEnter", ["pointerout", "pointerover"]),
    ll("onPointerLeave", ["pointerout", "pointerover"]),
    Dn("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")),
    Dn("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")),
    Dn("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]),
    Dn("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")),
    Dn("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")),
    Dn("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
    var Ma = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ")
      , xg = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(Ma));
    function Sh(t, e) {
        e = (e & 4) !== 0;
        for (var n = 0; n < t.length; n++) {
            var l = t[n]
              , a = l.event;
            l = l.listeners;
            t: {
                var u = void 0;
                if (e)
                    for (var o = l.length - 1; 0 <= o; o--) {
                        var f = l[o]
                          , d = f.instance
                          , p = f.currentTarget;
                        if (f = f.listener,
                        d !== u && a.isPropagationStopped())
                            break t;
                        u = f,
                        a.currentTarget = p;
                        try {
                            u(a)
                        } catch (O) {
                            Du(O)
                        }
                        a.currentTarget = null,
                        u = d
                    }
                else
                    for (o = 0; o < l.length; o++) {
                        if (f = l[o],
                        d = f.instance,
                        p = f.currentTarget,
                        f = f.listener,
                        d !== u && a.isPropagationStopped())
                            break t;
                        u = f,
                        a.currentTarget = p;
                        try {
                            u(a)
                        } catch (O) {
                            Du(O)
                        }
                        a.currentTarget = null,
                        u = d
                    }
            }
        }
    }
    function lt(t, e) {
        var n = e[_i];
        n === void 0 && (n = e[_i] = new Set);
        var l = t + "__bubble";
        n.has(l) || (bh(e, t, 2, !1),
        n.add(l))
    }
    function hc(t, e, n) {
        var l = 0;
        e && (l |= 4),
        bh(n, t, l, e)
    }
    var Zu = "_reactListening" + Math.random().toString(36).slice(2);
    function dc(t) {
        if (!t[Zu]) {
            t[Zu] = !0,
            or.forEach(function(n) {
                n !== "selectionchange" && (xg.has(n) || hc(n, !1, t),
                hc(n, !0, t))
            });
            var e = t.nodeType === 9 ? t : t.ownerDocument;
            e === null || e[Zu] || (e[Zu] = !0,
            hc("selectionchange", !1, e))
        }
    }
    function bh(t, e, n, l) {
        switch (Gh(e)) {
        case 2:
            var a = lv;
            break;
        case 8:
            a = av;
            break;
        default:
            a = Mc
        }
        n = a.bind(null, e, n, t),
        a = void 0,
        !Ni || e !== "touchstart" && e !== "touchmove" && e !== "wheel" || (a = !0),
        l ? a !== void 0 ? t.addEventListener(e, n, {
            capture: !0,
            passive: a
        }) : t.addEventListener(e, n, !0) : a !== void 0 ? t.addEventListener(e, n, {
            passive: a
        }) : t.addEventListener(e, n, !1)
    }
    function yc(t, e, n, l, a) {
        var u = l;
        if ((e & 1) === 0 && (e & 2) === 0 && l !== null)
            t: for (; ; ) {
                if (l === null)
                    return;
                var o = l.tag;
                if (o === 3 || o === 4) {
                    var f = l.stateNode.containerInfo;
                    if (f === a)
                        break;
                    if (o === 4)
                        for (o = l.return; o !== null; ) {
                            var d = o.tag;
                            if ((d === 3 || d === 4) && o.stateNode.containerInfo === a)
                                return;
                            o = o.return
                        }
                    for (; f !== null; ) {
                        if (o = tl(f),
                        o === null)
                            return;
                        if (d = o.tag,
                        d === 5 || d === 6 || d === 26 || d === 27) {
                            l = u = o;
                            continue t
                        }
                        f = f.parentNode
                    }
                }
                l = l.return
            }
        _r(function() {
            var p = u
              , O = zi(n)
              , w = [];
            t: {
                var A = Ir.get(t);
                if (A !== void 0) {
                    var R = iu
                      , k = t;
                    switch (t) {
                    case "keypress":
                        if (au(n) === 0)
                            break t;
                    case "keydown":
                    case "keyup":
                        R = _y;
                        break;
                    case "focusin":
                        k = "focus",
                        R = Li;
                        break;
                    case "focusout":
                        k = "blur",
                        R = Li;
                        break;
                    case "beforeblur":
                    case "afterblur":
                        R = Li;
                        break;
                    case "click":
                        if (n.button === 2)
                            break t;
                    case "auxclick":
                    case "dblclick":
                    case "mousedown":
                    case "mousemove":
                    case "mouseup":
                    case "mouseout":
                    case "mouseover":
                    case "contextmenu":
                        R = Mr;
                        break;
                    case "drag":
                    case "dragend":
                    case "dragenter":
                    case "dragexit":
                    case "dragleave":
                    case "dragover":
                    case "dragstart":
                    case "drop":
                        R = hy;
                        break;
                    case "touchcancel":
                    case "touchend":
                    case "touchmove":
                    case "touchstart":
                        R = My;
                        break;
                    case Jr:
                    case $r:
                    case Wr:
                        R = gy;
                        break;
                    case Fr:
                        R = qy;
                        break;
                    case "scroll":
                    case "scrollend":
                        R = oy;
                        break;
                    case "wheel":
                        R = Cy;
                        break;
                    case "copy":
                    case "cut":
                    case "paste":
                        R = my;
                        break;
                    case "gotpointercapture":
                    case "lostpointercapture":
                    case "pointercancel":
                    case "pointerdown":
                    case "pointermove":
                    case "pointerout":
                    case "pointerover":
                    case "pointerup":
                        R = qr;
                        break;
                    case "toggle":
                    case "beforetoggle":
                        R = zy
                    }
                    var V = (e & 4) !== 0
                      , ht = !V && (t === "scroll" || t === "scrollend")
                      , m = V ? A !== null ? A + "Capture" : null : A;
                    V = [];
                    for (var v = p, S; v !== null; ) {
                        var M = v;
                        if (S = M.stateNode,
                        M = M.tag,
                        M !== 5 && M !== 26 && M !== 27 || S === null || m === null || (M = Zl(v, m),
                        M != null && V.push(wa(v, M, S))),
                        ht)
                            break;
                        v = v.return
                    }
                    0 < V.length && (A = new R(A,k,null,n,O),
                    w.push({
                        event: A,
                        listeners: V
                    }))
                }
            }
            if ((e & 7) === 0) {
                t: {
                    if (A = t === "mouseover" || t === "pointerover",
                    R = t === "mouseout" || t === "pointerout",
                    A && n !== Di && (k = n.relatedTarget || n.fromElement) && (tl(k) || k[Pn]))
                        break t;
                    if ((R || A) && (A = O.window === O ? O : (A = O.ownerDocument) ? A.defaultView || A.parentWindow : window,
                    R ? (k = n.relatedTarget || n.toElement,
                    R = p,
                    k = k ? tl(k) : null,
                    k !== null && (ht = g(k),
                    V = k.tag,
                    k !== ht || V !== 5 && V !== 27 && V !== 6) && (k = null)) : (R = null,
                    k = p),
                    R !== k)) {
                        if (V = Mr,
                        M = "onMouseLeave",
                        m = "onMouseEnter",
                        v = "mouse",
                        (t === "pointerout" || t === "pointerover") && (V = qr,
                        M = "onPointerLeave",
                        m = "onPointerEnter",
                        v = "pointer"),
                        ht = R == null ? A : kl(R),
                        S = k == null ? A : kl(k),
                        A = new V(M,v + "leave",R,n,O),
                        A.target = ht,
                        A.relatedTarget = S,
                        M = null,
                        tl(O) === p && (V = new V(m,v + "enter",k,n,O),
                        V.target = S,
                        V.relatedTarget = ht,
                        M = V),
                        ht = M,
                        R && k)
                            e: {
                                for (V = R,
                                m = k,
                                v = 0,
                                S = V; S; S = Ul(S))
                                    v++;
                                for (S = 0,
                                M = m; M; M = Ul(M))
                                    S++;
                                for (; 0 < v - S; )
                                    V = Ul(V),
                                    v--;
                                for (; 0 < S - v; )
                                    m = Ul(m),
                                    S--;
                                for (; v--; ) {
                                    if (V === m || m !== null && V === m.alternate)
                                        break e;
                                    V = Ul(V),
                                    m = Ul(m)
                                }
                                V = null
                            }
                        else
                            V = null;
                        R !== null && ph(w, A, R, V, !1),
                        k !== null && ht !== null && ph(w, ht, k, V, !0)
                    }
                }
                t: {
                    if (A = p ? kl(p) : window,
                    R = A.nodeName && A.nodeName.toLowerCase(),
                    R === "select" || R === "input" && A.type === "file")
                        var B = Br;
                    else if (Nr(A))
                        if (Hr)
                            B = Gy;
                        else {
                            B = Vy;
                            var tt = jy
                        }
                    else
                        R = A.nodeName,
                        !R || R.toLowerCase() !== "input" || A.type !== "checkbox" && A.type !== "radio" ? p && Ci(p.elementType) && (B = Br) : B = Yy;
                    if (B && (B = B(t, p))) {
                        Qr(w, B, n, O);
                        break t
                    }
                    tt && tt(t, A, p),
                    t === "focusout" && p && A.type === "number" && p.memoizedProps.value != null && xi(A, "number", A.value)
                }
                switch (tt = p ? kl(p) : window,
                t) {
                case "focusin":
                    (Nr(tt) || tt.contentEditable === "true") && (ol = tt,
                    ki = p,
                    ta = null);
                    break;
                case "focusout":
                    ta = ki = ol = null;
                    break;
                case "mousedown":
                    Zi = !0;
                    break;
                case "contextmenu":
                case "mouseup":
                case "dragend":
                    Zi = !1,
                    Zr(w, n, O);
                    break;
                case "selectionchange":
                    if (ky)
                        break;
                case "keydown":
                case "keyup":
                    Zr(w, n, O)
                }
                var L;
                if (Vi)
                    t: {
                        switch (t) {
                        case "compositionstart":
                            var Y = "onCompositionStart";
                            break t;
                        case "compositionend":
                            Y = "onCompositionEnd";
                            break t;
                        case "compositionupdate":
                            Y = "onCompositionUpdate";
                            break t
                        }
                        Y = void 0
                    }
                else
                    rl ? zr(t, n) && (Y = "onCompositionEnd") : t === "keydown" && n.keyCode === 229 && (Y = "onCompositionStart");
                Y && (xr && n.locale !== "ko" && (rl || Y !== "onCompositionStart" ? Y === "onCompositionEnd" && rl && (L = Rr()) : (sn = O,
                Qi = "value"in sn ? sn.value : sn.textContent,
                rl = !0)),
                tt = Ku(p, Y),
                0 < tt.length && (Y = new wr(Y,t,null,n,O),
                w.push({
                    event: Y,
                    listeners: tt
                }),
                L ? Y.data = L : (L = Ur(n),
                L !== null && (Y.data = L)))),
                (L = Ny ? Qy(t, n) : By(t, n)) && (Y = Ku(p, "onBeforeInput"),
                0 < Y.length && (tt = new wr("onBeforeInput","beforeinput",null,n,O),
                w.push({
                    event: tt,
                    listeners: Y
                }),
                tt.data = L)),
                Mg(w, t, p, n, O)
            }
            Sh(w, e)
        })
    }
    function wa(t, e, n) {
        return {
            instance: t,
            listener: e,
            currentTarget: n
        }
    }
    function Ku(t, e) {
        for (var n = e + "Capture", l = []; t !== null; ) {
            var a = t
              , u = a.stateNode;
            if (a = a.tag,
            a !== 5 && a !== 26 && a !== 27 || u === null || (a = Zl(t, n),
            a != null && l.unshift(wa(t, a, u)),
            a = Zl(t, e),
            a != null && l.push(wa(t, a, u))),
            t.tag === 3)
                return l;
            t = t.return
        }
        return []
    }
    function Ul(t) {
        if (t === null)
            return null;
        do
            t = t.return;
        while (t && t.tag !== 5 && t.tag !== 27);
        return t || null
    }
    function ph(t, e, n, l, a) {
        for (var u = e._reactName, o = []; n !== null && n !== l; ) {
            var f = n
              , d = f.alternate
              , p = f.stateNode;
            if (f = f.tag,
            d !== null && d === l)
                break;
            f !== 5 && f !== 26 && f !== 27 || p === null || (d = p,
            a ? (p = Zl(n, u),
            p != null && o.unshift(wa(n, p, d))) : a || (p = Zl(n, u),
            p != null && o.push(wa(n, p, d)))),
            n = n.return
        }
        o.length !== 0 && t.push({
            event: e,
            listeners: o
        })
    }
    var Cg = /\r\n?/g
      , Dg = /\u0000|\uFFFD/g;
    function Th(t) {
        return (typeof t == "string" ? t : "" + t).replace(Cg, `
`).replace(Dg, "")
    }
    function Ah(t, e) {
        return e = Th(e),
        Th(t) === e
    }
    function Ju() {}
    function ft(t, e, n, l, a, u) {
        switch (n) {
        case "children":
            typeof l == "string" ? e === "body" || e === "textarea" && l === "" || il(t, l) : (typeof l == "number" || typeof l == "bigint") && e !== "body" && il(t, "" + l);
            break;
        case "className":
            Pa(t, "class", l);
            break;
        case "tabIndex":
            Pa(t, "tabindex", l);
            break;
        case "dir":
        case "role":
        case "viewBox":
        case "width":
        case "height":
            Pa(t, n, l);
            break;
        case "style":
            Ar(t, l, u);
            break;
        case "data":
            if (e !== "object") {
                Pa(t, "data", l);
                break
            }
        case "src":
        case "href":
            if (l === "" && (e !== "a" || n !== "href")) {
                t.removeAttribute(n);
                break
            }
            if (l == null || typeof l == "function" || typeof l == "symbol" || typeof l == "boolean") {
                t.removeAttribute(n);
                break
            }
            l = nu("" + l),
            t.setAttribute(n, l);
            break;
        case "action":
        case "formAction":
            if (typeof l == "function") {
                t.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
                break
            } else
                typeof u == "function" && (n === "formAction" ? (e !== "input" && ft(t, e, "name", a.name, a, null),
                ft(t, e, "formEncType", a.formEncType, a, null),
                ft(t, e, "formMethod", a.formMethod, a, null),
                ft(t, e, "formTarget", a.formTarget, a, null)) : (ft(t, e, "encType", a.encType, a, null),
                ft(t, e, "method", a.method, a, null),
                ft(t, e, "target", a.target, a, null)));
            if (l == null || typeof l == "symbol" || typeof l == "boolean") {
                t.removeAttribute(n);
                break
            }
            l = nu("" + l),
            t.setAttribute(n, l);
            break;
        case "onClick":
            l != null && (t.onclick = Ju);
            break;
        case "onScroll":
            l != null && lt("scroll", t);
            break;
        case "onScrollEnd":
            l != null && lt("scrollend", t);
            break;
        case "dangerouslySetInnerHTML":
            if (l != null) {
                if (typeof l != "object" || !("__html"in l))
                    throw Error(r(61));
                if (n = l.__html,
                n != null) {
                    if (a.children != null)
                        throw Error(r(60));
                    t.innerHTML = n
                }
            }
            break;
        case "multiple":
            t.multiple = l && typeof l != "function" && typeof l != "symbol";
            break;
        case "muted":
            t.muted = l && typeof l != "function" && typeof l != "symbol";
            break;
        case "suppressContentEditableWarning":
        case "suppressHydrationWarning":
        case "defaultValue":
        case "defaultChecked":
        case "innerHTML":
        case "ref":
            break;
        case "autoFocus":
            break;
        case "xlinkHref":
            if (l == null || typeof l == "function" || typeof l == "boolean" || typeof l == "symbol") {
                t.removeAttribute("xlink:href");
                break
            }
            n = nu("" + l),
            t.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
            break;
        case "contentEditable":
        case "spellCheck":
        case "draggable":
        case "value":
        case "autoReverse":
        case "externalResourcesRequired":
        case "focusable":
        case "preserveAlpha":
            l != null && typeof l != "function" && typeof l != "symbol" ? t.setAttribute(n, "" + l) : t.removeAttribute(n);
            break;
        case "inert":
        case "allowFullScreen":
        case "async":
        case "autoPlay":
        case "controls":
        case "default":
        case "defer":
        case "disabled":
        case "disablePictureInPicture":
        case "disableRemotePlayback":
        case "formNoValidate":
        case "hidden":
        case "loop":
        case "noModule":
        case "noValidate":
        case "open":
        case "playsInline":
        case "readOnly":
        case "required":
        case "reversed":
        case "scoped":
        case "seamless":
        case "itemScope":
            l && typeof l != "function" && typeof l != "symbol" ? t.setAttribute(n, "") : t.removeAttribute(n);
            break;
        case "capture":
        case "download":
            l === !0 ? t.setAttribute(n, "") : l !== !1 && l != null && typeof l != "function" && typeof l != "symbol" ? t.setAttribute(n, l) : t.removeAttribute(n);
            break;
        case "cols":
        case "rows":
        case "size":
        case "span":
            l != null && typeof l != "function" && typeof l != "symbol" && !isNaN(l) && 1 <= l ? t.setAttribute(n, l) : t.removeAttribute(n);
            break;
        case "rowSpan":
        case "start":
            l == null || typeof l == "function" || typeof l == "symbol" || isNaN(l) ? t.removeAttribute(n) : t.setAttribute(n, l);
            break;
        case "popover":
            lt("beforetoggle", t),
            lt("toggle", t),
            Ia(t, "popover", l);
            break;
        case "xlinkActuate":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:actuate", l);
            break;
        case "xlinkArcrole":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:arcrole", l);
            break;
        case "xlinkRole":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:role", l);
            break;
        case "xlinkShow":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:show", l);
            break;
        case "xlinkTitle":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:title", l);
            break;
        case "xlinkType":
            Ye(t, "http://www.w3.org/1999/xlink", "xlink:type", l);
            break;
        case "xmlBase":
            Ye(t, "http://www.w3.org/XML/1998/namespace", "xml:base", l);
            break;
        case "xmlLang":
            Ye(t, "http://www.w3.org/XML/1998/namespace", "xml:lang", l);
            break;
        case "xmlSpace":
            Ye(t, "http://www.w3.org/XML/1998/namespace", "xml:space", l);
            break;
        case "is":
            Ia(t, "is", l);
            break;
        case "innerText":
        case "textContent":
            break;
        default:
            (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") && (n = cy.get(n) || n,
            Ia(t, n, l))
        }
    }
    function gc(t, e, n, l, a, u) {
        switch (n) {
        case "style":
            Ar(t, l, u);
            break;
        case "dangerouslySetInnerHTML":
            if (l != null) {
                if (typeof l != "object" || !("__html"in l))
                    throw Error(r(61));
                if (n = l.__html,
                n != null) {
                    if (a.children != null)
                        throw Error(r(60));
                    t.innerHTML = n
                }
            }
            break;
        case "children":
            typeof l == "string" ? il(t, l) : (typeof l == "number" || typeof l == "bigint") && il(t, "" + l);
            break;
        case "onScroll":
            l != null && lt("scroll", t);
            break;
        case "onScrollEnd":
            l != null && lt("scrollend", t);
            break;
        case "onClick":
            l != null && (t.onclick = Ju);
            break;
        case "suppressContentEditableWarning":
        case "suppressHydrationWarning":
        case "innerHTML":
        case "ref":
            break;
        case "innerText":
        case "textContent":
            break;
        default:
            if (!fr.hasOwnProperty(n))
                t: {
                    if (n[0] === "o" && n[1] === "n" && (a = n.endsWith("Capture"),
                    e = n.slice(2, a ? n.length - 7 : void 0),
                    u = t[Ft] || null,
                    u = u != null ? u[n] : null,
                    typeof u == "function" && t.removeEventListener(e, u, a),
                    typeof l == "function")) {
                        typeof u != "function" && u !== null && (n in t ? t[n] = null : t.hasAttribute(n) && t.removeAttribute(n)),
                        t.addEventListener(e, l, a);
                        break t
                    }
                    n in t ? t[n] = l : l === !0 ? t.setAttribute(n, "") : Ia(t, n, l)
                }
        }
    }
    function jt(t, e, n) {
        switch (e) {
        case "div":
        case "span":
        case "svg":
        case "path":
        case "a":
        case "g":
        case "p":
        case "li":
            break;
        case "img":
            lt("error", t),
            lt("load", t);
            var l = !1, a = !1, u;
            for (u in n)
                if (n.hasOwnProperty(u)) {
                    var o = n[u];
                    if (o != null)
                        switch (u) {
                        case "src":
                            l = !0;
                            break;
                        case "srcSet":
                            a = !0;
                            break;
                        case "children":
                        case "dangerouslySetInnerHTML":
                            throw Error(r(137, e));
                        default:
                            ft(t, e, u, o, n, null)
                        }
                }
            a && ft(t, e, "srcSet", n.srcSet, n, null),
            l && ft(t, e, "src", n.src, n, null);
            return;
        case "input":
            lt("invalid", t);
            var f = u = o = a = null
              , d = null
              , p = null;
            for (l in n)
                if (n.hasOwnProperty(l)) {
                    var O = n[l];
                    if (O != null)
                        switch (l) {
                        case "name":
                            a = O;
                            break;
                        case "type":
                            o = O;
                            break;
                        case "checked":
                            d = O;
                            break;
                        case "defaultChecked":
                            p = O;
                            break;
                        case "value":
                            u = O;
                            break;
                        case "defaultValue":
                            f = O;
                            break;
                        case "children":
                        case "dangerouslySetInnerHTML":
                            if (O != null)
                                throw Error(r(137, e));
                            break;
                        default:
                            ft(t, e, l, O, n, null)
                        }
                }
            Sr(t, u, f, d, p, o, a, !1),
            tu(t);
            return;
        case "select":
            lt("invalid", t),
            l = o = u = null;
            for (a in n)
                if (n.hasOwnProperty(a) && (f = n[a],
                f != null))
                    switch (a) {
                    case "value":
                        u = f;
                        break;
                    case "defaultValue":
                        o = f;
                        break;
                    case "multiple":
                        l = f;
                    default:
                        ft(t, e, a, f, n, null)
                    }
            e = u,
            n = o,
            t.multiple = !!l,
            e != null ? ul(t, !!l, e, !1) : n != null && ul(t, !!l, n, !0);
            return;
        case "textarea":
            lt("invalid", t),
            u = a = l = null;
            for (o in n)
                if (n.hasOwnProperty(o) && (f = n[o],
                f != null))
                    switch (o) {
                    case "value":
                        l = f;
                        break;
                    case "defaultValue":
                        a = f;
                        break;
                    case "children":
                        u = f;
                        break;
                    case "dangerouslySetInnerHTML":
                        if (f != null)
                            throw Error(r(91));
                        break;
                    default:
                        ft(t, e, o, f, n, null)
                    }
            pr(t, l, a, u),
            tu(t);
            return;
        case "option":
            for (d in n)
                if (n.hasOwnProperty(d) && (l = n[d],
                l != null))
                    switch (d) {
                    case "selected":
                        t.selected = l && typeof l != "function" && typeof l != "symbol";
                        break;
                    default:
                        ft(t, e, d, l, n, null)
                    }
            return;
        case "dialog":
            lt("beforetoggle", t),
            lt("toggle", t),
            lt("cancel", t),
            lt("close", t);
            break;
        case "iframe":
        case "object":
            lt("load", t);
            break;
        case "video":
        case "audio":
            for (l = 0; l < Ma.length; l++)
                lt(Ma[l], t);
            break;
        case "image":
            lt("error", t),
            lt("load", t);
            break;
        case "details":
            lt("toggle", t);
            break;
        case "embed":
        case "source":
        case "link":
            lt("error", t),
            lt("load", t);
        case "area":
        case "base":
        case "br":
        case "col":
        case "hr":
        case "keygen":
        case "meta":
        case "param":
        case "track":
        case "wbr":
        case "menuitem":
            for (p in n)
                if (n.hasOwnProperty(p) && (l = n[p],
                l != null))
                    switch (p) {
                    case "children":
                    case "dangerouslySetInnerHTML":
                        throw Error(r(137, e));
                    default:
                        ft(t, e, p, l, n, null)
                    }
            return;
        default:
            if (Ci(e)) {
                for (O in n)
                    n.hasOwnProperty(O) && (l = n[O],
                    l !== void 0 && gc(t, e, O, l, n, void 0));
                return
            }
        }
        for (f in n)
            n.hasOwnProperty(f) && (l = n[f],
            l != null && ft(t, e, f, l, n, null))
    }
    function zg(t, e, n, l) {
        switch (e) {
        case "div":
        case "span":
        case "svg":
        case "path":
        case "a":
        case "g":
        case "p":
        case "li":
            break;
        case "input":
            var a = null
              , u = null
              , o = null
              , f = null
              , d = null
              , p = null
              , O = null;
            for (R in n) {
                var w = n[R];
                if (n.hasOwnProperty(R) && w != null)
                    switch (R) {
                    case "checked":
                        break;
                    case "value":
                        break;
                    case "defaultValue":
                        d = w;
                    default:
                        l.hasOwnProperty(R) || ft(t, e, R, null, l, w)
                    }
            }
            for (var A in l) {
                var R = l[A];
                if (w = n[A],
                l.hasOwnProperty(A) && (R != null || w != null))
                    switch (A) {
                    case "type":
                        u = R;
                        break;
                    case "name":
                        a = R;
                        break;
                    case "checked":
                        p = R;
                        break;
                    case "defaultChecked":
                        O = R;
                        break;
                    case "value":
                        o = R;
                        break;
                    case "defaultValue":
                        f = R;
                        break;
                    case "children":
                    case "dangerouslySetInnerHTML":
                        if (R != null)
                            throw Error(r(137, e));
                        break;
                    default:
                        R !== w && ft(t, e, A, R, l, w)
                    }
            }
            qi(t, o, f, d, p, O, u, a);
            return;
        case "select":
            R = o = f = A = null;
            for (u in n)
                if (d = n[u],
                n.hasOwnProperty(u) && d != null)
                    switch (u) {
                    case "value":
                        break;
                    case "multiple":
                        R = d;
                    default:
                        l.hasOwnProperty(u) || ft(t, e, u, null, l, d)
                    }
            for (a in l)
                if (u = l[a],
                d = n[a],
                l.hasOwnProperty(a) && (u != null || d != null))
                    switch (a) {
                    case "value":
                        A = u;
                        break;
                    case "defaultValue":
                        f = u;
                        break;
                    case "multiple":
                        o = u;
                    default:
                        u !== d && ft(t, e, a, u, l, d)
                    }
            e = f,
            n = o,
            l = R,
            A != null ? ul(t, !!n, A, !1) : !!l != !!n && (e != null ? ul(t, !!n, e, !0) : ul(t, !!n, n ? [] : "", !1));
            return;
        case "textarea":
            R = A = null;
            for (f in n)
                if (a = n[f],
                n.hasOwnProperty(f) && a != null && !l.hasOwnProperty(f))
                    switch (f) {
                    case "value":
                        break;
                    case "children":
                        break;
                    default:
                        ft(t, e, f, null, l, a)
                    }
            for (o in l)
                if (a = l[o],
                u = n[o],
                l.hasOwnProperty(o) && (a != null || u != null))
                    switch (o) {
                    case "value":
                        A = a;
                        break;
                    case "defaultValue":
                        R = a;
                        break;
                    case "children":
                        break;
                    case "dangerouslySetInnerHTML":
                        if (a != null)
                            throw Error(r(91));
                        break;
                    default:
                        a !== u && ft(t, e, o, a, l, u)
                    }
            br(t, A, R);
            return;
        case "option":
            for (var k in n)
                if (A = n[k],
                n.hasOwnProperty(k) && A != null && !l.hasOwnProperty(k))
                    switch (k) {
                    case "selected":
                        t.selected = !1;
                        break;
                    default:
                        ft(t, e, k, null, l, A)
                    }
            for (d in l)
                if (A = l[d],
                R = n[d],
                l.hasOwnProperty(d) && A !== R && (A != null || R != null))
                    switch (d) {
                    case "selected":
                        t.selected = A && typeof A != "function" && typeof A != "symbol";
                        break;
                    default:
                        ft(t, e, d, A, l, R)
                    }
            return;
        case "img":
        case "link":
        case "area":
        case "base":
        case "br":
        case "col":
        case "embed":
        case "hr":
        case "keygen":
        case "meta":
        case "param":
        case "source":
        case "track":
        case "wbr":
        case "menuitem":
            for (var V in n)
                A = n[V],
                n.hasOwnProperty(V) && A != null && !l.hasOwnProperty(V) && ft(t, e, V, null, l, A);
            for (p in l)
                if (A = l[p],
                R = n[p],
                l.hasOwnProperty(p) && A !== R && (A != null || R != null))
                    switch (p) {
                    case "children":
                    case "dangerouslySetInnerHTML":
                        if (A != null)
                            throw Error(r(137, e));
                        break;
                    default:
                        ft(t, e, p, A, l, R)
                    }
            return;
        default:
            if (Ci(e)) {
                for (var ht in n)
                    A = n[ht],
                    n.hasOwnProperty(ht) && A !== void 0 && !l.hasOwnProperty(ht) && gc(t, e, ht, void 0, l, A);
                for (O in l)
                    A = l[O],
                    R = n[O],
                    !l.hasOwnProperty(O) || A === R || A === void 0 && R === void 0 || gc(t, e, O, A, l, R);
                return
            }
        }
        for (var m in n)
            A = n[m],
            n.hasOwnProperty(m) && A != null && !l.hasOwnProperty(m) && ft(t, e, m, null, l, A);
        for (w in l)
            A = l[w],
            R = n[w],
            !l.hasOwnProperty(w) || A === R || A == null && R == null || ft(t, e, w, A, l, R)
    }
    var vc = null
      , mc = null;
    function $u(t) {
        return t.nodeType === 9 ? t : t.ownerDocument
    }
    function Eh(t) {
        switch (t) {
        case "http://www.w3.org/2000/svg":
            return 1;
        case "http://www.w3.org/1998/Math/MathML":
            return 2;
        default:
            return 0
        }
    }
    function _h(t, e) {
        if (t === 0)
            switch (e) {
            case "svg":
                return 1;
            case "math":
                return 2;
            default:
                return 0
            }
        return t === 1 && e === "foreignObject" ? 0 : t
    }
    function Sc(t, e) {
        return t === "textarea" || t === "noscript" || typeof e.children == "string" || typeof e.children == "number" || typeof e.children == "bigint" || typeof e.dangerouslySetInnerHTML == "object" && e.dangerouslySetInnerHTML !== null && e.dangerouslySetInnerHTML.__html != null
    }
    var bc = null;
    function Ug() {
        var t = window.event;
        return t && t.type === "popstate" ? t === bc ? !1 : (bc = t,
        !0) : (bc = null,
        !1)
    }
    var Rh = typeof setTimeout == "function" ? setTimeout : void 0
      , Ng = typeof clearTimeout == "function" ? clearTimeout : void 0
      , Oh = typeof Promise == "function" ? Promise : void 0
      , Qg = typeof queueMicrotask == "function" ? queueMicrotask : typeof Oh < "u" ? function(t) {
        return Oh.resolve(null).then(t).catch(Bg)
    }
    : Rh;
    function Bg(t) {
        setTimeout(function() {
            throw t
        })
    }
    function En(t) {
        return t === "head"
    }
    function Mh(t, e) {
        var n = e
          , l = 0
          , a = 0;
        do {
            var u = n.nextSibling;
            if (t.removeChild(n),
            u && u.nodeType === 8)
                if (n = u.data,
                n === "/$") {
                    if (0 < l && 8 > l) {
                        n = l;
                        var o = t.ownerDocument;
                        if (n & 1 && qa(o.documentElement),
                        n & 2 && qa(o.body),
                        n & 4)
                            for (n = o.head,
                            qa(n),
                            o = n.firstChild; o; ) {
                                var f = o.nextSibling
                                  , d = o.nodeName;
                                o[Xl] || d === "SCRIPT" || d === "STYLE" || d === "LINK" && o.rel.toLowerCase() === "stylesheet" || n.removeChild(o),
                                o = f
                            }
                    }
                    if (a === 0) {
                        t.removeChild(u),
                        Ba(e);
                        return
                    }
                    a--
                } else
                    n === "$" || n === "$?" || n === "$!" ? a++ : l = n.charCodeAt(0) - 48;
            else
                l = 0;
            n = u
        } while (n);
        Ba(e)
    }
    function pc(t) {
        var e = t.firstChild;
        for (e && e.nodeType === 10 && (e = e.nextSibling); e; ) {
            var n = e;
            switch (e = e.nextSibling,
            n.nodeName) {
            case "HTML":
            case "HEAD":
            case "BODY":
                pc(n),
                Ri(n);
                continue;
            case "SCRIPT":
            case "STYLE":
                continue;
            case "LINK":
                if (n.rel.toLowerCase() === "stylesheet")
                    continue
            }
            t.removeChild(n)
        }
    }
    function Hg(t, e, n, l) {
        for (; t.nodeType === 1; ) {
            var a = n;
            if (t.nodeName.toLowerCase() !== e.toLowerCase()) {
                if (!l && (t.nodeName !== "INPUT" || t.type !== "hidden"))
                    break
            } else if (l) {
                if (!t[Xl])
                    switch (e) {
                    case "meta":
                        if (!t.hasAttribute("itemprop"))
                            break;
                        return t;
                    case "link":
                        if (u = t.getAttribute("rel"),
                        u === "stylesheet" && t.hasAttribute("data-precedence"))
                            break;
                        if (u !== a.rel || t.getAttribute("href") !== (a.href == null || a.href === "" ? null : a.href) || t.getAttribute("crossorigin") !== (a.crossOrigin == null ? null : a.crossOrigin) || t.getAttribute("title") !== (a.title == null ? null : a.title))
                            break;
                        return t;
                    case "style":
                        if (t.hasAttribute("data-precedence"))
                            break;
                        return t;
                    case "script":
                        if (u = t.getAttribute("src"),
                        (u !== (a.src == null ? null : a.src) || t.getAttribute("type") !== (a.type == null ? null : a.type) || t.getAttribute("crossorigin") !== (a.crossOrigin == null ? null : a.crossOrigin)) && u && t.hasAttribute("async") && !t.hasAttribute("itemprop"))
                            break;
                        return t;
                    default:
                        return t
                    }
            } else if (e === "input" && t.type === "hidden") {
                var u = a.name == null ? null : "" + a.name;
                if (a.type === "hidden" && t.getAttribute("name") === u)
                    return t
            } else
                return t;
            if (t = we(t.nextSibling),
            t === null)
                break
        }
        return null
    }
    function Lg(t, e, n) {
        if (e === "")
            return null;
        for (; t.nodeType !== 3; )
            if ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") && !n || (t = we(t.nextSibling),
            t === null))
                return null;
        return t
    }
    function Tc(t) {
        return t.data === "$!" || t.data === "$?" && t.ownerDocument.readyState === "complete"
    }
    function jg(t, e) {
        var n = t.ownerDocument;
        if (t.data !== "$?" || n.readyState === "complete")
            e();
        else {
            var l = function() {
                e(),
                n.removeEventListener("DOMContentLoaded", l)
            };
            n.addEventListener("DOMContentLoaded", l),
            t._reactRetry = l
        }
    }
    function we(t) {
        for (; t != null; t = t.nextSibling) {
            var e = t.nodeType;
            if (e === 1 || e === 3)
                break;
            if (e === 8) {
                if (e = t.data,
                e === "$" || e === "$!" || e === "$?" || e === "F!" || e === "F")
                    break;
                if (e === "/$")
                    return null
            }
        }
        return t
    }
    var Ac = null;
    function wh(t) {
        t = t.previousSibling;
        for (var e = 0; t; ) {
            if (t.nodeType === 8) {
                var n = t.data;
                if (n === "$" || n === "$!" || n === "$?") {
                    if (e === 0)
                        return t;
                    e--
                } else
                    n === "/$" && e++
            }
            t = t.previousSibling
        }
        return null
    }
    function qh(t, e, n) {
        switch (e = $u(n),
        t) {
        case "html":
            if (t = e.documentElement,
            !t)
                throw Error(r(452));
            return t;
        case "head":
            if (t = e.head,
            !t)
                throw Error(r(453));
            return t;
        case "body":
            if (t = e.body,
            !t)
                throw Error(r(454));
            return t;
        default:
            throw Error(r(451))
        }
    }
    function qa(t) {
        for (var e = t.attributes; e.length; )
            t.removeAttributeNode(e[0]);
        Ri(t)
    }
    var Ae = new Map
      , xh = new Set;
    function Wu(t) {
        return typeof t.getRootNode == "function" ? t.getRootNode() : t.nodeType === 9 ? t : t.ownerDocument
    }
    var nn = C.d;
    C.d = {
        f: Vg,
        r: Yg,
        D: Gg,
        C: Xg,
        L: kg,
        m: Zg,
        X: Jg,
        S: Kg,
        M: $g
    };
    function Vg() {
        var t = nn.f()
          , e = Vu();
        return t || e
    }
    function Yg(t) {
        var e = el(t);
        e !== null && e.tag === 5 && e.type === "form" ? $o(e) : nn.r(t)
    }
    var Nl = typeof document > "u" ? null : document;
    function Ch(t, e, n) {
        var l = Nl;
        if (l && typeof e == "string" && e) {
            var a = ge(e);
            a = 'link[rel="' + t + '"][href="' + a + '"]',
            typeof n == "string" && (a += '[crossorigin="' + n + '"]'),
            xh.has(a) || (xh.add(a),
            t = {
                rel: t,
                crossOrigin: n,
                href: e
            },
            l.querySelector(a) === null && (e = l.createElement("link"),
            jt(e, "link", t),
            Dt(e),
            l.head.appendChild(e)))
        }
    }
    function Gg(t) {
        nn.D(t),
        Ch("dns-prefetch", t, null)
    }
    function Xg(t, e) {
        nn.C(t, e),
        Ch("preconnect", t, e)
    }
    function kg(t, e, n) {
        nn.L(t, e, n);
        var l = Nl;
        if (l && t && e) {
            var a = 'link[rel="preload"][as="' + ge(e) + '"]';
            e === "image" && n && n.imageSrcSet ? (a += '[imagesrcset="' + ge(n.imageSrcSet) + '"]',
            typeof n.imageSizes == "string" && (a += '[imagesizes="' + ge(n.imageSizes) + '"]')) : a += '[href="' + ge(t) + '"]';
            var u = a;
            switch (e) {
            case "style":
                u = Ql(t);
                break;
            case "script":
                u = Bl(t)
            }
            Ae.has(u) || (t = D({
                rel: "preload",
                href: e === "image" && n && n.imageSrcSet ? void 0 : t,
                as: e
            }, n),
            Ae.set(u, t),
            l.querySelector(a) !== null || e === "style" && l.querySelector(xa(u)) || e === "script" && l.querySelector(Ca(u)) || (e = l.createElement("link"),
            jt(e, "link", t),
            Dt(e),
            l.head.appendChild(e)))
        }
    }
    function Zg(t, e) {
        nn.m(t, e);
        var n = Nl;
        if (n && t) {
            var l = e && typeof e.as == "string" ? e.as : "script"
              , a = 'link[rel="modulepreload"][as="' + ge(l) + '"][href="' + ge(t) + '"]'
              , u = a;
            switch (l) {
            case "audioworklet":
            case "paintworklet":
            case "serviceworker":
            case "sharedworker":
            case "worker":
            case "script":
                u = Bl(t)
            }
            if (!Ae.has(u) && (t = D({
                rel: "modulepreload",
                href: t
            }, e),
            Ae.set(u, t),
            n.querySelector(a) === null)) {
                switch (l) {
                case "audioworklet":
                case "paintworklet":
                case "serviceworker":
                case "sharedworker":
                case "worker":
                case "script":
                    if (n.querySelector(Ca(u)))
                        return
                }
                l = n.createElement("link"),
                jt(l, "link", t),
                Dt(l),
                n.head.appendChild(l)
            }
        }
    }
    function Kg(t, e, n) {
        nn.S(t, e, n);
        var l = Nl;
        if (l && t) {
            var a = nl(l).hoistableStyles
              , u = Ql(t);
            e = e || "default";
            var o = a.get(u);
            if (!o) {
                var f = {
                    loading: 0,
                    preload: null
                };
                if (o = l.querySelector(xa(u)))
                    f.loading = 5;
                else {
                    t = D({
                        rel: "stylesheet",
                        href: t,
                        "data-precedence": e
                    }, n),
                    (n = Ae.get(u)) && Ec(t, n);
                    var d = o = l.createElement("link");
                    Dt(d),
                    jt(d, "link", t),
                    d._p = new Promise(function(p, O) {
                        d.onload = p,
                        d.onerror = O
                    }
                    ),
                    d.addEventListener("load", function() {
                        f.loading |= 1
                    }),
                    d.addEventListener("error", function() {
                        f.loading |= 2
                    }),
                    f.loading |= 4,
                    Fu(o, e, l)
                }
                o = {
                    type: "stylesheet",
                    instance: o,
                    count: 1,
                    state: f
                },
                a.set(u, o)
            }
        }
    }
    function Jg(t, e) {
        nn.X(t, e);
        var n = Nl;
        if (n && t) {
            var l = nl(n).hoistableScripts
              , a = Bl(t)
              , u = l.get(a);
            u || (u = n.querySelector(Ca(a)),
            u || (t = D({
                src: t,
                async: !0
            }, e),
            (e = Ae.get(a)) && _c(t, e),
            u = n.createElement("script"),
            Dt(u),
            jt(u, "link", t),
            n.head.appendChild(u)),
            u = {
                type: "script",
                instance: u,
                count: 1,
                state: null
            },
            l.set(a, u))
        }
    }
    function $g(t, e) {
        nn.M(t, e);
        var n = Nl;
        if (n && t) {
            var l = nl(n).hoistableScripts
              , a = Bl(t)
              , u = l.get(a);
            u || (u = n.querySelector(Ca(a)),
            u || (t = D({
                src: t,
                async: !0,
                type: "module"
            }, e),
            (e = Ae.get(a)) && _c(t, e),
            u = n.createElement("script"),
            Dt(u),
            jt(u, "link", t),
            n.head.appendChild(u)),
            u = {
                type: "script",
                instance: u,
                count: 1,
                state: null
            },
            l.set(a, u))
        }
    }
    function Dh(t, e, n, l) {
        var a = (a = J.current) ? Wu(a) : null;
        if (!a)
            throw Error(r(446));
        switch (t) {
        case "meta":
        case "title":
            return null;
        case "style":
            return typeof n.precedence == "string" && typeof n.href == "string" ? (e = Ql(n.href),
            n = nl(a).hoistableStyles,
            l = n.get(e),
            l || (l = {
                type: "style",
                instance: null,
                count: 0,
                state: null
            },
            n.set(e, l)),
            l) : {
                type: "void",
                instance: null,
                count: 0,
                state: null
            };
        case "link":
            if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
                t = Ql(n.href);
                var u = nl(a).hoistableStyles
                  , o = u.get(t);
                if (o || (a = a.ownerDocument || a,
                o = {
                    type: "stylesheet",
                    instance: null,
                    count: 0,
                    state: {
                        loading: 0,
                        preload: null
                    }
                },
                u.set(t, o),
                (u = a.querySelector(xa(t))) && !u._p && (o.instance = u,
                o.state.loading = 5),
                Ae.has(t) || (n = {
                    rel: "preload",
                    as: "style",
                    href: n.href,
                    crossOrigin: n.crossOrigin,
                    integrity: n.integrity,
                    media: n.media,
                    hrefLang: n.hrefLang,
                    referrerPolicy: n.referrerPolicy
                },
                Ae.set(t, n),
                u || Wg(a, t, n, o.state))),
                e && l === null)
                    throw Error(r(528, ""));
                return o
            }
            if (e && l !== null)
                throw Error(r(529, ""));
            return null;
        case "script":
            return e = n.async,
            n = n.src,
            typeof n == "string" && e && typeof e != "function" && typeof e != "symbol" ? (e = Bl(n),
            n = nl(a).hoistableScripts,
            l = n.get(e),
            l || (l = {
                type: "script",
                instance: null,
                count: 0,
                state: null
            },
            n.set(e, l)),
            l) : {
                type: "void",
                instance: null,
                count: 0,
                state: null
            };
        default:
            throw Error(r(444, t))
        }
    }
    function Ql(t) {
        return 'href="' + ge(t) + '"'
    }
    function xa(t) {
        return 'link[rel="stylesheet"][' + t + "]"
    }
    function zh(t) {
        return D({}, t, {
            "data-precedence": t.precedence,
            precedence: null
        })
    }
    function Wg(t, e, n, l) {
        t.querySelector('link[rel="preload"][as="style"][' + e + "]") ? l.loading = 1 : (e = t.createElement("link"),
        l.preload = e,
        e.addEventListener("load", function() {
            return l.loading |= 1
        }),
        e.addEventListener("error", function() {
            return l.loading |= 2
        }),
        jt(e, "link", n),
        Dt(e),
        t.head.appendChild(e))
    }
    function Bl(t) {
        return '[src="' + ge(t) + '"]'
    }
    function Ca(t) {
        return "script[async]" + t
    }
    function Uh(t, e, n) {
        if (e.count++,
        e.instance === null)
            switch (e.type) {
            case "style":
                var l = t.querySelector('style[data-href~="' + ge(n.href) + '"]');
                if (l)
                    return e.instance = l,
                    Dt(l),
                    l;
                var a = D({}, n, {
                    "data-href": n.href,
                    "data-precedence": n.precedence,
                    href: null,
                    precedence: null
                });
                return l = (t.ownerDocument || t).createElement("style"),
                Dt(l),
                jt(l, "style", a),
                Fu(l, n.precedence, t),
                e.instance = l;
            case "stylesheet":
                a = Ql(n.href);
                var u = t.querySelector(xa(a));
                if (u)
                    return e.state.loading |= 4,
                    e.instance = u,
                    Dt(u),
                    u;
                l = zh(n),
                (a = Ae.get(a)) && Ec(l, a),
                u = (t.ownerDocument || t).createElement("link"),
                Dt(u);
                var o = u;
                return o._p = new Promise(function(f, d) {
                    o.onload = f,
                    o.onerror = d
                }
                ),
                jt(u, "link", l),
                e.state.loading |= 4,
                Fu(u, n.precedence, t),
                e.instance = u;
            case "script":
                return u = Bl(n.src),
                (a = t.querySelector(Ca(u))) ? (e.instance = a,
                Dt(a),
                a) : (l = n,
                (a = Ae.get(u)) && (l = D({}, n),
                _c(l, a)),
                t = t.ownerDocument || t,
                a = t.createElement("script"),
                Dt(a),
                jt(a, "link", l),
                t.head.appendChild(a),
                e.instance = a);
            case "void":
                return null;
            default:
                throw Error(r(443, e.type))
            }
        else
            e.type === "stylesheet" && (e.state.loading & 4) === 0 && (l = e.instance,
            e.state.loading |= 4,
            Fu(l, n.precedence, t));
        return e.instance
    }
    function Fu(t, e, n) {
        for (var l = n.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'), a = l.length ? l[l.length - 1] : null, u = a, o = 0; o < l.length; o++) {
            var f = l[o];
            if (f.dataset.precedence === e)
                u = f;
            else if (u !== a)
                break
        }
        u ? u.parentNode.insertBefore(t, u.nextSibling) : (e = n.nodeType === 9 ? n.head : n,
        e.insertBefore(t, e.firstChild))
    }
    function Ec(t, e) {
        t.crossOrigin == null && (t.crossOrigin = e.crossOrigin),
        t.referrerPolicy == null && (t.referrerPolicy = e.referrerPolicy),
        t.title == null && (t.title = e.title)
    }
    function _c(t, e) {
        t.crossOrigin == null && (t.crossOrigin = e.crossOrigin),
        t.referrerPolicy == null && (t.referrerPolicy = e.referrerPolicy),
        t.integrity == null && (t.integrity = e.integrity)
    }
    var Iu = null;
    function Nh(t, e, n) {
        if (Iu === null) {
            var l = new Map
              , a = Iu = new Map;
            a.set(n, l)
        } else
            a = Iu,
            l = a.get(n),
            l || (l = new Map,
            a.set(n, l));
        if (l.has(t))
            return l;
        for (l.set(t, null),
        n = n.getElementsByTagName(t),
        a = 0; a < n.length; a++) {
            var u = n[a];
            if (!(u[Xl] || u[Yt] || t === "link" && u.getAttribute("rel") === "stylesheet") && u.namespaceURI !== "http://www.w3.org/2000/svg") {
                var o = u.getAttribute(e) || "";
                o = t + o;
                var f = l.get(o);
                f ? f.push(u) : l.set(o, [u])
            }
        }
        return l
    }
    function Qh(t, e, n) {
        t = t.ownerDocument || t,
        t.head.insertBefore(n, e === "title" ? t.querySelector("head > title") : null)
    }
    function Fg(t, e, n) {
        if (n === 1 || e.itemProp != null)
            return !1;
        switch (t) {
        case "meta":
        case "title":
            return !0;
        case "style":
            if (typeof e.precedence != "string" || typeof e.href != "string" || e.href === "")
                break;
            return !0;
        case "link":
            if (typeof e.rel != "string" || typeof e.href != "string" || e.href === "" || e.onLoad || e.onError)
                break;
            switch (e.rel) {
            case "stylesheet":
                return t = e.disabled,
                typeof e.precedence == "string" && t == null;
            default:
                return !0
            }
        case "script":
            if (e.async && typeof e.async != "function" && typeof e.async != "symbol" && !e.onLoad && !e.onError && e.src && typeof e.src == "string")
                return !0
        }
        return !1
    }
    function Bh(t) {
        return !(t.type === "stylesheet" && (t.state.loading & 3) === 0)
    }
    var Da = null;
    function Ig() {}
    function Pg(t, e, n) {
        if (Da === null)
            throw Error(r(475));
        var l = Da;
        if (e.type === "stylesheet" && (typeof n.media != "string" || matchMedia(n.media).matches !== !1) && (e.state.loading & 4) === 0) {
            if (e.instance === null) {
                var a = Ql(n.href)
                  , u = t.querySelector(xa(a));
                if (u) {
                    t = u._p,
                    t !== null && typeof t == "object" && typeof t.then == "function" && (l.count++,
                    l = Pu.bind(l),
                    t.then(l, l)),
                    e.state.loading |= 4,
                    e.instance = u,
                    Dt(u);
                    return
                }
                u = t.ownerDocument || t,
                n = zh(n),
                (a = Ae.get(a)) && Ec(n, a),
                u = u.createElement("link"),
                Dt(u);
                var o = u;
                o._p = new Promise(function(f, d) {
                    o.onload = f,
                    o.onerror = d
                }
                ),
                jt(u, "link", n),
                e.instance = u
            }
            l.stylesheets === null && (l.stylesheets = new Map),
            l.stylesheets.set(e, t),
            (t = e.state.preload) && (e.state.loading & 3) === 0 && (l.count++,
            e = Pu.bind(l),
            t.addEventListener("load", e),
            t.addEventListener("error", e))
        }
    }
    function tv() {
        if (Da === null)
            throw Error(r(475));
        var t = Da;
        return t.stylesheets && t.count === 0 && Rc(t, t.stylesheets),
        0 < t.count ? function(e) {
            var n = setTimeout(function() {
                if (t.stylesheets && Rc(t, t.stylesheets),
                t.unsuspend) {
                    var l = t.unsuspend;
                    t.unsuspend = null,
                    l()
                }
            }, 6e4);
            return t.unsuspend = e,
            function() {
                t.unsuspend = null,
                clearTimeout(n)
            }
        }
        : null
    }
    function Pu() {
        if (this.count--,
        this.count === 0) {
            if (this.stylesheets)
                Rc(this, this.stylesheets);
            else if (this.unsuspend) {
                var t = this.unsuspend;
                this.unsuspend = null,
                t()
            }
        }
    }
    var ti = null;
    function Rc(t, e) {
        t.stylesheets = null,
        t.unsuspend !== null && (t.count++,
        ti = new Map,
        e.forEach(ev, t),
        ti = null,
        Pu.call(t))
    }
    function ev(t, e) {
        if (!(e.state.loading & 4)) {
            var n = ti.get(t);
            if (n)
                var l = n.get(null);
            else {
                n = new Map,
                ti.set(t, n);
                for (var a = t.querySelectorAll("link[data-precedence],style[data-precedence]"), u = 0; u < a.length; u++) {
                    var o = a[u];
                    (o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o),
                    l = o)
                }
                l && n.set(null, l)
            }
            a = e.instance,
            o = a.getAttribute("data-precedence"),
            u = n.get(o) || l,
            u === l && n.set(null, a),
            n.set(o, a),
            this.count++,
            l = Pu.bind(this),
            a.addEventListener("load", l),
            a.addEventListener("error", l),
            u ? u.parentNode.insertBefore(a, u.nextSibling) : (t = t.nodeType === 9 ? t.head : t,
            t.insertBefore(a, t.firstChild)),
            e.state.loading |= 4
        }
    }
    var za = {
        $$typeof: St,
        Provider: null,
        Consumer: null,
        _currentValue: U,
        _currentValue2: U,
        _threadCount: 0
    };
    function nv(t, e, n, l, a, u, o, f) {
        this.tag = 1,
        this.containerInfo = t,
        this.pingCache = this.current = this.pendingChildren = null,
        this.timeoutHandle = -1,
        this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null,
        this.callbackPriority = 0,
        this.expirationTimes = Ti(-1),
        this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0,
        this.entanglements = Ti(0),
        this.hiddenUpdates = Ti(null),
        this.identifierPrefix = l,
        this.onUncaughtError = a,
        this.onCaughtError = u,
        this.onRecoverableError = o,
        this.pooledCache = null,
        this.pooledCacheLanes = 0,
        this.formState = f,
        this.incompleteTransitions = new Map
    }
    function Hh(t, e, n, l, a, u, o, f, d, p, O, w) {
        return t = new nv(t,e,n,o,f,d,p,w),
        e = 1,
        u === !0 && (e |= 24),
        u = se(3, null, null, e),
        t.current = u,
        u.stateNode = t,
        e = is(),
        e.refCount++,
        t.pooledCache = e,
        e.refCount++,
        u.memoizedState = {
            element: l,
            isDehydrated: n,
            cache: e
        },
        os(u),
        t
    }
    function Lh(t) {
        return t ? (t = yl,
        t) : yl
    }
    function jh(t, e, n, l, a, u) {
        a = Lh(a),
        l.context === null ? l.context = a : l.pendingContext = a,
        l = on(e),
        l.payload = {
            element: n
        },
        u = u === void 0 ? null : u,
        u !== null && (l.callback = u),
        n = fn(t, l, e),
        n !== null && (he(n, t, e),
        ra(n, t, e))
    }
    function Vh(t, e) {
        if (t = t.memoizedState,
        t !== null && t.dehydrated !== null) {
            var n = t.retryLane;
            t.retryLane = n !== 0 && n < e ? n : e
        }
    }
    function Oc(t, e) {
        Vh(t, e),
        (t = t.alternate) && Vh(t, e)
    }
    function Yh(t) {
        if (t.tag === 13) {
            var e = dl(t, 67108864);
            e !== null && he(e, t, 67108864),
            Oc(t, 67108864)
        }
    }
    var ei = !0;
    function lv(t, e, n, l) {
        var a = _.T;
        _.T = null;
        var u = C.p;
        try {
            C.p = 2,
            Mc(t, e, n, l)
        } finally {
            C.p = u,
            _.T = a
        }
    }
    function av(t, e, n, l) {
        var a = _.T;
        _.T = null;
        var u = C.p;
        try {
            C.p = 8,
            Mc(t, e, n, l)
        } finally {
            C.p = u,
            _.T = a
        }
    }
    function Mc(t, e, n, l) {
        if (ei) {
            var a = wc(l);
            if (a === null)
                yc(t, e, l, ni, n),
                Xh(t, l);
            else if (iv(a, t, e, n, l))
                l.stopPropagation();
            else if (Xh(t, l),
            e & 4 && -1 < uv.indexOf(t)) {
                for (; a !== null; ) {
                    var u = el(a);
                    if (u !== null)
                        switch (u.tag) {
                        case 3:
                            if (u = u.stateNode,
                            u.current.memoizedState.isDehydrated) {
                                var o = Cn(u.pendingLanes);
                                if (o !== 0) {
                                    var f = u;
                                    for (f.pendingLanes |= 2,
                                    f.entangledLanes |= 2; o; ) {
                                        var d = 1 << 31 - ue(o);
                                        f.entanglements[1] |= d,
                                        o &= ~d
                                    }
                                    Be(u),
                                    (ct & 6) === 0 && (Lu = De() + 500,
                                    Oa(0))
                                }
                            }
                            break;
                        case 13:
                            f = dl(u, 2),
                            f !== null && he(f, u, 2),
                            Vu(),
                            Oc(u, 2)
                        }
                    if (u = wc(l),
                    u === null && yc(t, e, l, ni, n),
                    u === a)
                        break;
                    a = u
                }
                a !== null && l.stopPropagation()
            } else
                yc(t, e, l, null, n)
        }
    }
    function wc(t) {
        return t = zi(t),
        qc(t)
    }
    var ni = null;
    function qc(t) {
        if (ni = null,
        t = tl(t),
        t !== null) {
            var e = g(t);
            if (e === null)
                t = null;
            else {
                var n = e.tag;
                if (n === 13) {
                    if (t = E(e),
                    t !== null)
                        return t;
                    t = null
                } else if (n === 3) {
                    if (e.stateNode.current.memoizedState.isDehydrated)
                        return e.tag === 3 ? e.stateNode.containerInfo : null;
                    t = null
                } else
                    e !== t && (t = null)
            }
        }
        return ni = t,
        null
    }
    function Gh(t) {
        switch (t) {
        case "beforetoggle":
        case "cancel":
        case "click":
        case "close":
        case "contextmenu":
        case "copy":
        case "cut":
        case "auxclick":
        case "dblclick":
        case "dragend":
        case "dragstart":
        case "drop":
        case "focusin":
        case "focusout":
        case "input":
        case "invalid":
        case "keydown":
        case "keypress":
        case "keyup":
        case "mousedown":
        case "mouseup":
        case "paste":
        case "pause":
        case "play":
        case "pointercancel":
        case "pointerdown":
        case "pointerup":
        case "ratechange":
        case "reset":
        case "resize":
        case "seeked":
        case "submit":
        case "toggle":
        case "touchcancel":
        case "touchend":
        case "touchstart":
        case "volumechange":
        case "change":
        case "selectionchange":
        case "textInput":
        case "compositionstart":
        case "compositionend":
        case "compositionupdate":
        case "beforeblur":
        case "afterblur":
        case "beforeinput":
        case "blur":
        case "fullscreenchange":
        case "focus":
        case "hashchange":
        case "popstate":
        case "select":
        case "selectstart":
            return 2;
        case "drag":
        case "dragenter":
        case "dragexit":
        case "dragleave":
        case "dragover":
        case "mousemove":
        case "mouseout":
        case "mouseover":
        case "pointermove":
        case "pointerout":
        case "pointerover":
        case "scroll":
        case "touchmove":
        case "wheel":
        case "mouseenter":
        case "mouseleave":
        case "pointerenter":
        case "pointerleave":
            return 8;
        case "message":
            switch (Xd()) {
            case er:
                return 2;
            case nr:
                return 8;
            case Ja:
            case kd:
                return 32;
            case lr:
                return 268435456;
            default:
                return 32
            }
        default:
            return 32
        }
    }
    var xc = !1
      , _n = null
      , Rn = null
      , On = null
      , Ua = new Map
      , Na = new Map
      , Mn = []
      , uv = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
    function Xh(t, e) {
        switch (t) {
        case "focusin":
        case "focusout":
            _n = null;
            break;
        case "dragenter":
        case "dragleave":
            Rn = null;
            break;
        case "mouseover":
        case "mouseout":
            On = null;
            break;
        case "pointerover":
        case "pointerout":
            Ua.delete(e.pointerId);
            break;
        case "gotpointercapture":
        case "lostpointercapture":
            Na.delete(e.pointerId)
        }
    }
    function Qa(t, e, n, l, a, u) {
        return t === null || t.nativeEvent !== u ? (t = {
            blockedOn: e,
            domEventName: n,
            eventSystemFlags: l,
            nativeEvent: u,
            targetContainers: [a]
        },
        e !== null && (e = el(e),
        e !== null && Yh(e)),
        t) : (t.eventSystemFlags |= l,
        e = t.targetContainers,
        a !== null && e.indexOf(a) === -1 && e.push(a),
        t)
    }
    function iv(t, e, n, l, a) {
        switch (e) {
        case "focusin":
            return _n = Qa(_n, t, e, n, l, a),
            !0;
        case "dragenter":
            return Rn = Qa(Rn, t, e, n, l, a),
            !0;
        case "mouseover":
            return On = Qa(On, t, e, n, l, a),
            !0;
        case "pointerover":
            var u = a.pointerId;
            return Ua.set(u, Qa(Ua.get(u) || null, t, e, n, l, a)),
            !0;
        case "gotpointercapture":
            return u = a.pointerId,
            Na.set(u, Qa(Na.get(u) || null, t, e, n, l, a)),
            !0
        }
        return !1
    }
    function kh(t) {
        var e = tl(t.target);
        if (e !== null) {
            var n = g(e);
            if (n !== null) {
                if (e = n.tag,
                e === 13) {
                    if (e = E(n),
                    e !== null) {
                        t.blockedOn = e,
                        Pd(t.priority, function() {
                            if (n.tag === 13) {
                                var l = fe();
                                l = Ai(l);
                                var a = dl(n, l);
                                a !== null && he(a, n, l),
                                Oc(n, l)
                            }
                        });
                        return
                    }
                } else if (e === 3 && n.stateNode.current.memoizedState.isDehydrated) {
                    t.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
                    return
                }
            }
        }
        t.blockedOn = null
    }
    function li(t) {
        if (t.blockedOn !== null)
            return !1;
        for (var e = t.targetContainers; 0 < e.length; ) {
            var n = wc(t.nativeEvent);
            if (n === null) {
                n = t.nativeEvent;
                var l = new n.constructor(n.type,n);
                Di = l,
                n.target.dispatchEvent(l),
                Di = null
            } else
                return e = el(n),
                e !== null && Yh(e),
                t.blockedOn = n,
                !1;
            e.shift()
        }
        return !0
    }
    function Zh(t, e, n) {
        li(t) && n.delete(e)
    }
    function sv() {
        xc = !1,
        _n !== null && li(_n) && (_n = null),
        Rn !== null && li(Rn) && (Rn = null),
        On !== null && li(On) && (On = null),
        Ua.forEach(Zh),
        Na.forEach(Zh)
    }
    function ai(t, e) {
        t.blockedOn === e && (t.blockedOn = null,
        xc || (xc = !0,
        c.unstable_scheduleCallback(c.unstable_NormalPriority, sv)))
    }
    var ui = null;
    function Kh(t) {
        ui !== t && (ui = t,
        c.unstable_scheduleCallback(c.unstable_NormalPriority, function() {
            ui === t && (ui = null);
            for (var e = 0; e < t.length; e += 3) {
                var n = t[e]
                  , l = t[e + 1]
                  , a = t[e + 2];
                if (typeof l != "function") {
                    if (qc(l || n) === null)
                        continue;
                    break
                }
                var u = el(n);
                u !== null && (t.splice(e, 3),
                e -= 3,
                qs(u, {
                    pending: !0,
                    data: a,
                    method: n.method,
                    action: l
                }, l, a))
            }
        }))
    }
    function Ba(t) {
        function e(d) {
            return ai(d, t)
        }
        _n !== null && ai(_n, t),
        Rn !== null && ai(Rn, t),
        On !== null && ai(On, t),
        Ua.forEach(e),
        Na.forEach(e);
        for (var n = 0; n < Mn.length; n++) {
            var l = Mn[n];
            l.blockedOn === t && (l.blockedOn = null)
        }
        for (; 0 < Mn.length && (n = Mn[0],
        n.blockedOn === null); )
            kh(n),
            n.blockedOn === null && Mn.shift();
        if (n = (t.ownerDocument || t).$$reactFormReplay,
        n != null)
            for (l = 0; l < n.length; l += 3) {
                var a = n[l]
                  , u = n[l + 1]
                  , o = a[Ft] || null;
                if (typeof u == "function")
                    o || Kh(n);
                else if (o) {
                    var f = null;
                    if (u && u.hasAttribute("formAction")) {
                        if (a = u,
                        o = u[Ft] || null)
                            f = o.formAction;
                        else if (qc(a) !== null)
                            continue
                    } else
                        f = o.action;
                    typeof f == "function" ? n[l + 1] = f : (n.splice(l, 3),
                    l -= 3),
                    Kh(n)
                }
            }
    }
    function Cc(t) {
        this._internalRoot = t
    }
    ii.prototype.render = Cc.prototype.render = function(t) {
        var e = this._internalRoot;
        if (e === null)
            throw Error(r(409));
        var n = e.current
          , l = fe();
        jh(n, l, t, e, null, null)
    }
    ,
    ii.prototype.unmount = Cc.prototype.unmount = function() {
        var t = this._internalRoot;
        if (t !== null) {
            this._internalRoot = null;
            var e = t.containerInfo;
            jh(t.current, 2, null, t, null, null),
            Vu(),
            e[Pn] = null
        }
    }
    ;
    function ii(t) {
        this._internalRoot = t
    }
    ii.prototype.unstable_scheduleHydration = function(t) {
        if (t) {
            var e = cr();
            t = {
                blockedOn: null,
                target: t,
                priority: e
            };
            for (var n = 0; n < Mn.length && e !== 0 && e < Mn[n].priority; n++)
                ;
            Mn.splice(n, 0, t),
            n === 0 && kh(t)
        }
    }
    ;
    var Jh = i.version;
    if (Jh !== "19.1.0")
        throw Error(r(527, Jh, "19.1.0"));
    C.findDOMNode = function(t) {
        var e = t._reactInternals;
        if (e === void 0)
            throw typeof t.render == "function" ? Error(r(188)) : (t = Object.keys(t).join(","),
            Error(r(268, t)));
        return t = T(e),
        t = t !== null ? b(t) : null,
        t = t === null ? null : t.stateNode,
        t
    }
    ;
    var cv = {
        bundleType: 0,
        version: "19.1.0",
        rendererPackageName: "react-dom",
        currentDispatcherRef: _,
        reconcilerVersion: "19.1.0"
    };
    if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
        var si = __REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!si.isDisabled && si.supportsFiber)
            try {
                Vl = si.inject(cv),
                ae = si
            } catch {}
    }
    return La.createRoot = function(t, e) {
        if (!h(t))
            throw Error(r(299));
        var n = !1
          , l = ""
          , a = of
          , u = ff
          , o = hf
          , f = null;
        return e != null && (e.unstable_strictMode === !0 && (n = !0),
        e.identifierPrefix !== void 0 && (l = e.identifierPrefix),
        e.onUncaughtError !== void 0 && (a = e.onUncaughtError),
        e.onCaughtError !== void 0 && (u = e.onCaughtError),
        e.onRecoverableError !== void 0 && (o = e.onRecoverableError),
        e.unstable_transitionCallbacks !== void 0 && (f = e.unstable_transitionCallbacks)),
        e = Hh(t, 1, !1, null, null, n, l, a, u, o, f, null),
        t[Pn] = e.current,
        dc(t),
        new Cc(e)
    }
    ,
    La.hydrateRoot = function(t, e, n) {
        if (!h(t))
            throw Error(r(299));
        var l = !1
          , a = ""
          , u = of
          , o = ff
          , f = hf
          , d = null
          , p = null;
        return n != null && (n.unstable_strictMode === !0 && (l = !0),
        n.identifierPrefix !== void 0 && (a = n.identifierPrefix),
        n.onUncaughtError !== void 0 && (u = n.onUncaughtError),
        n.onCaughtError !== void 0 && (o = n.onCaughtError),
        n.onRecoverableError !== void 0 && (f = n.onRecoverableError),
        n.unstable_transitionCallbacks !== void 0 && (d = n.unstable_transitionCallbacks),
        n.formState !== void 0 && (p = n.formState)),
        e = Hh(t, 1, !0, e, n ?? null, l, a, u, o, f, d, p),
        e.context = Lh(null),
        n = e.current,
        l = fe(),
        l = Ai(l),
        a = on(l),
        a.callback = null,
        fn(n, a, l),
        n = l,
        e.current.lanes = n,
        Gl(e, n),
        Be(e),
        t[Pn] = e.current,
        dc(t),
        new ii(e)
    }
    ,
    La.version = "19.1.0",
    La
}
var ad;
function bv() {
    if (ad)
        return Uc.exports;
    ad = 1;
    function c() {
        if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"))
            try {
                __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(c)
            } catch (i) {
                console.error(i)
            }
    }
    return c(),
    Uc.exports = Sv(),
    Uc.exports
}
var pv = bv();
const Wn = "1.24.8";
var Le = []
  , _e = []
  , Tv = Uint8Array
  , Hc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
for (var Hl = 0, Av = Hc.length; Hl < Av; ++Hl)
    Le[Hl] = Hc[Hl],
    _e[Hc.charCodeAt(Hl)] = Hl;
_e[45] = 62;
_e[95] = 63;
function Ev(c) {
    var i = c.length;
    if (i % 4 > 0)
        throw new Error("Invalid string. Length must be a multiple of 4");
    var s = c.indexOf("=");
    s === -1 && (s = i);
    var r = s === i ? 0 : 4 - s % 4;
    return [s, r]
}
function _v(c, i, s) {
    return (i + s) * 3 / 4 - s
}
function Ga(c) {
    var i, s = Ev(c), r = s[0], h = s[1], g = new Tv(_v(c, r, h)), E = 0, x = h > 0 ? r - 4 : r, T;
    for (T = 0; T < x; T += 4)
        i = _e[c.charCodeAt(T)] << 18 | _e[c.charCodeAt(T + 1)] << 12 | _e[c.charCodeAt(T + 2)] << 6 | _e[c.charCodeAt(T + 3)],
        g[E++] = i >> 16 & 255,
        g[E++] = i >> 8 & 255,
        g[E++] = i & 255;
    return h === 2 && (i = _e[c.charCodeAt(T)] << 2 | _e[c.charCodeAt(T + 1)] >> 4,
    g[E++] = i & 255),
    h === 1 && (i = _e[c.charCodeAt(T)] << 10 | _e[c.charCodeAt(T + 1)] << 4 | _e[c.charCodeAt(T + 2)] >> 2,
    g[E++] = i >> 8 & 255,
    g[E++] = i & 255),
    g
}
function Rv(c) {
    return Le[c >> 18 & 63] + Le[c >> 12 & 63] + Le[c >> 6 & 63] + Le[c & 63]
}
function Ov(c, i, s) {
    for (var r, h = [], g = i; g < s; g += 3)
        r = (c[g] << 16 & 16711680) + (c[g + 1] << 8 & 65280) + (c[g + 2] & 255),
        h.push(Rv(r));
    return h.join("")
}
function Xa(c) {
    for (var i, s = c.length, r = s % 3, h = [], g = 16383, E = 0, x = s - r; E < x; E += g)
        h.push(Ov(c, E, E + g > x ? x : E + g));
    return r === 1 ? (i = c[s - 1],
    h.push(Le[i >> 2] + Le[i << 4 & 63] + "==")) : r === 2 && (i = (c[s - 2] << 8) + c[s - 1],
    h.push(Le[i >> 10] + Le[i >> 4 & 63] + Le[i << 2 & 63] + "=")),
    h.join("")
}
function ne(c) {
    if (c === void 0)
        return {};
    if (!bd(c))
        throw new Error(`The arguments to a Convex function must be an object. Received: ${c}`);
    return c
}
function Sd(c) {
    if (typeof c > "u")
        throw new Error("Client created with undefined deployment address. If you used an environment variable, check that it's set.");
    if (typeof c != "string")
        throw new Error(`Invalid deployment address: found ${c}".`);
    if (!(c.startsWith("http:") || c.startsWith("https:")))
        throw new Error(`Invalid deployment address: Must start with "https://" or "http://". Found "${c}".`);
    try {
        new URL(c)
    } catch {
        throw new Error(`Invalid deployment address: "${c}" is not a valid URL. If you believe this URL is correct, use the \`skipConvexDeploymentUrlCheck\` option to bypass this.`)
    }
    if (c.endsWith(".convex.site"))
        throw new Error(`Invalid deployment address: "${c}" ends with .convex.site, which is used for HTTP Actions. Convex deployment URLs typically end with .convex.cloud? If you believe this URL is correct, use the \`skipConvexDeploymentUrlCheck\` option to bypass this.`)
}
function bd(c) {
    var h;
    const i = typeof c == "object"
      , s = Object.getPrototypeOf(c)
      , r = s === null || s === Object.prototype || ((h = s == null ? void 0 : s.constructor) == null ? void 0 : h.name) === "Object";
    return i && r
}
const pd = !0
  , jl = BigInt("-9223372036854775808")
  , Fc = BigInt("9223372036854775807")
  , Kc = BigInt("0")
  , Mv = BigInt("8")
  , wv = BigInt("256");
function Td(c) {
    return Number.isNaN(c) || !Number.isFinite(c) || Object.is(c, -0)
}
function qv(c) {
    c < Kc && (c -= jl + jl);
    let i = c.toString(16);
    i.length % 2 === 1 && (i = "0" + i);
    const s = new Uint8Array(new ArrayBuffer(8));
    let r = 0;
    for (const h of i.match(/.{2}/g).reverse())
        s.set([parseInt(h, 16)], r++),
        c >>= Mv;
    return Xa(s)
}
function xv(c) {
    const i = Ga(c);
    if (i.byteLength !== 8)
        throw new Error(`Received ${i.byteLength} bytes, expected 8 for $integer`);
    let s = Kc
      , r = Kc;
    for (const h of i)
        s += BigInt(h) * wv ** r,
        r++;
    return s > Fc && (s += jl + jl),
    s
}
function Cv(c) {
    if (c < jl || Fc < c)
        throw new Error(`BigInt ${c} does not fit into a 64-bit signed integer.`);
    const i = new ArrayBuffer(8);
    return new DataView(i).setBigInt64(0, c, !0),
    Xa(new Uint8Array(i))
}
function Dv(c) {
    const i = Ga(c);
    if (i.byteLength !== 8)
        throw new Error(`Received ${i.byteLength} bytes, expected 8 for $integer`);
    return new DataView(i.buffer).getBigInt64(0, !0)
}
const zv = DataView.prototype.setBigInt64 ? Cv : qv
  , Uv = DataView.prototype.getBigInt64 ? Dv : xv
  , ud = 1024;
function Ad(c) {
    if (c.length > ud)
        throw new Error(`Field name ${c} exceeds maximum field name length ${ud}.`);
    if (c.startsWith("$"))
        throw new Error(`Field name ${c} starts with a '$', which is reserved.`);
    for (let i = 0; i < c.length; i += 1) {
        const s = c.charCodeAt(i);
        if (s < 32 || s >= 127)
            throw new Error(`Field name ${c} has invalid character '${c[i]}': Field names can only contain non-control ASCII characters`)
    }
}
function xe(c) {
    if (c === null || typeof c == "boolean" || typeof c == "number" || typeof c == "string")
        return c;
    if (Array.isArray(c))
        return c.map(r => xe(r));
    if (typeof c != "object")
        throw new Error(`Unexpected type of ${c}`);
    const i = Object.entries(c);
    if (i.length === 1) {
        const r = i[0][0];
        if (r === "$bytes") {
            if (typeof c.$bytes != "string")
                throw new Error(`Malformed $bytes field on ${c}`);
            return Ga(c.$bytes).buffer
        }
        if (r === "$integer") {
            if (typeof c.$integer != "string")
                throw new Error(`Malformed $integer field on ${c}`);
            return Uv(c.$integer)
        }
        if (r === "$float") {
            if (typeof c.$float != "string")
                throw new Error(`Malformed $float field on ${c}`);
            const h = Ga(c.$float);
            if (h.byteLength !== 8)
                throw new Error(`Received ${h.byteLength} bytes, expected 8 for $float`);
            const E = new DataView(h.buffer).getFloat64(0, pd);
            if (!Td(E))
                throw new Error(`Float ${E} should be encoded as a number`);
            return E
        }
        if (r === "$set")
            throw new Error("Received a Set which is no longer supported as a Convex type.");
        if (r === "$map")
            throw new Error("Received a Map which is no longer supported as a Convex type.")
    }
    const s = {};
    for (const [r,h] of Object.entries(c))
        Ad(r),
        s[r] = xe(h);
    return s
}
function Va(c) {
    return JSON.stringify(c, (i, s) => s === void 0 ? "undefined" : typeof s == "bigint" ? `${s.toString()}n` : s)
}
function Jc(c, i, s, r) {
    var E;
    if (c === void 0) {
        const x = s && ` (present at path ${s} in original object ${Va(i)})`;
        throw new Error(`undefined is not a valid Convex value${x}. To learn about Convex's supported types, see https://docs.convex.dev/using/types.`)
    }
    if (c === null)
        return c;
    if (typeof c == "bigint") {
        if (c < jl || Fc < c)
            throw new Error(`BigInt ${c} does not fit into a 64-bit signed integer.`);
        return {
            $integer: zv(c)
        }
    }
    if (typeof c == "number")
        if (Td(c)) {
            const x = new ArrayBuffer(8);
            return new DataView(x).setFloat64(0, c, pd),
            {
                $float: Xa(new Uint8Array(x))
            }
        } else
            return c;
    if (typeof c == "boolean" || typeof c == "string")
        return c;
    if (c instanceof ArrayBuffer)
        return {
            $bytes: Xa(new Uint8Array(c))
        };
    if (Array.isArray(c))
        return c.map( (x, T) => Jc(x, i, s + `[${T}]`));
    if (c instanceof Set)
        throw new Error(Lc(s, "Set", [...c], i));
    if (c instanceof Map)
        throw new Error(Lc(s, "Map", [...c], i));
    if (!bd(c)) {
        const x = (E = c == null ? void 0 : c.constructor) == null ? void 0 : E.name
          , T = x ? `${x} ` : "";
        throw new Error(Lc(s, T, c, i))
    }
    const h = {}
      , g = Object.entries(c);
    g.sort( ([x,T], [b,D]) => x === b ? 0 : x < b ? -1 : 1);
    for (const [x,T] of g)
        T !== void 0 && (Ad(x),
        h[x] = Jc(T, i, s + `.${x}`));
    return h
}
function Lc(c, i, s, r) {
    return c ? `${i}${Va(s)} is not a supported Convex type (present at path ${c} in original object ${Va(r)}). To learn about Convex's supported types, see https://docs.convex.dev/using/types.` : `${i}${Va(s)} is not a supported Convex type.`
}
function Re(c) {
    return Jc(c, c, "")
}
var Nv = Object.defineProperty, Qv = (c, i, s) => i in c ? Nv(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s, jc = (c, i, s) => Qv(c, typeof i != "symbol" ? i + "" : i, s), id, sd;
const Bv = Symbol.for("ConvexError");
class Fn extends (sd = Error,
id = Bv,
sd) {
    constructor(i) {
        super(typeof i == "string" ? i : Va(i)),
        jc(this, "name", "ConvexError"),
        jc(this, "data"),
        jc(this, id, !0),
        this.data = i
    }
}
const Ed = () => Array.from({
    length: 4
}, () => 0);
Ed();
Ed();
var Hv = Object.defineProperty
  , Lv = (c, i, s) => i in c ? Hv(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , cd = (c, i, s) => Lv(c, typeof i != "symbol" ? i + "" : i, s);
const jv = "color:rgb(0, 145, 255)";
function _d(c) {
    switch (c) {
    case "query":
        return "Q";
    case "mutation":
        return "M";
    case "action":
        return "A";
    case "any":
        return "?"
    }
}
class Rd {
    constructor(i) {
        cd(this, "_onLogLineFuncs"),
        cd(this, "_verbose"),
        this._onLogLineFuncs = {},
        this._verbose = i.verbose
    }
    addLogLineListener(i) {
        let s = Math.random().toString(36).substring(2, 15);
        for (let r = 0; r < 10 && this._onLogLineFuncs[s] !== void 0; r++)
            s = Math.random().toString(36).substring(2, 15);
        return this._onLogLineFuncs[s] = i,
        () => {
            delete this._onLogLineFuncs[s]
        }
    }
    logVerbose(...i) {
        if (this._verbose)
            for (const s of Object.values(this._onLogLineFuncs))
                s("debug", `${new Date().toISOString()}`, ...i)
    }
    log(...i) {
        for (const s of Object.values(this._onLogLineFuncs))
            s("info", ...i)
    }
    warn(...i) {
        for (const s of Object.values(this._onLogLineFuncs))
            s("warn", ...i)
    }
    error(...i) {
        for (const s of Object.values(this._onLogLineFuncs))
            s("error", ...i)
    }
}
function Ic(c) {
    const i = new Rd(c);
    return i.addLogLineListener( (s, ...r) => {
        switch (s) {
        case "debug":
            console.debug(...r);
            break;
        case "info":
            console.log(...r);
            break;
        case "warn":
            console.warn(...r);
            break;
        case "error":
            console.error(...r);
            break;
        default:
            console.log(...r)
        }
    }
    ),
    i
}
function Pc(c) {
    return new Rd(c)
}
function xn(c, i, s, r, h) {
    const g = _d(s);
    if (typeof h == "object" && (h = `ConvexError ${JSON.stringify(h.errorData, null, 2)}`),
    i === "info") {
        const E = h.match(/^\[.*?\] /);
        if (E === null) {
            c.error(`[CONVEX ${g}(${r})] Could not parse console.log`);
            return
        }
        const x = h.slice(1, E[0].length - 2)
          , T = h.slice(E[0].length);
        c.log(`%c[CONVEX ${g}(${r})] [${x}]`, jv, T)
    } else
        c.error(`[CONVEX ${g}(${r})] ${h}`)
}
function Vv(c, i) {
    const s = `[CONVEX FATAL ERROR] ${i}`;
    return c.error(s),
    new Error(s)
}
function Ll(c, i, s) {
    return `[CONVEX ${_d(c)}(${i})] ${s.errorMessage}
  Called by client`
}
function $c(c, i) {
    return i.data = c.errorData,
    i
}
function gi(c) {
    const i = c.split(":");
    let s, r;
    return i.length === 1 ? (s = i[0],
    r = "default") : (s = i.slice(0, i.length - 1).join(":"),
    r = i[i.length - 1]),
    s.endsWith(".js") && (s = s.slice(0, -3)),
    `${s}:${r}`
}
function In(c, i) {
    return JSON.stringify({
        udfPath: gi(c),
        args: Re(i)
    })
}
var Yv = Object.defineProperty
  , Gv = (c, i, s) => i in c ? Yv(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , He = (c, i, s) => Gv(c, typeof i != "symbol" ? i + "" : i, s);
class Xv {
    constructor() {
        He(this, "nextQueryId"),
        He(this, "querySetVersion"),
        He(this, "querySet"),
        He(this, "queryIdToToken"),
        He(this, "identityVersion"),
        He(this, "auth"),
        He(this, "outstandingQueriesOlderThanRestart"),
        He(this, "outstandingAuthOlderThanRestart"),
        He(this, "paused"),
        He(this, "pendingQuerySetModifications"),
        this.nextQueryId = 0,
        this.querySetVersion = 0,
        this.identityVersion = 0,
        this.querySet = new Map,
        this.queryIdToToken = new Map,
        this.outstandingQueriesOlderThanRestart = new Set,
        this.outstandingAuthOlderThanRestart = !1,
        this.paused = !1,
        this.pendingQuerySetModifications = new Map
    }
    hasSyncedPastLastReconnect() {
        return this.outstandingQueriesOlderThanRestart.size === 0 && !this.outstandingAuthOlderThanRestart
    }
    markAuthCompletion() {
        this.outstandingAuthOlderThanRestart = !1
    }
    subscribe(i, s, r, h) {
        const g = gi(i)
          , E = In(g, s)
          , x = this.querySet.get(E);
        if (x !== void 0)
            return x.numSubscribers += 1,
            {
                queryToken: E,
                modification: null,
                unsubscribe: () => this.removeSubscriber(E)
            };
        {
            const T = this.nextQueryId++
              , b = {
                id: T,
                canonicalizedUdfPath: g,
                args: s,
                numSubscribers: 1,
                journal: r,
                componentPath: h
            };
            this.querySet.set(E, b),
            this.queryIdToToken.set(T, E);
            const D = this.querySetVersion
              , Z = this.querySetVersion + 1
              , z = {
                type: "Add",
                queryId: T,
                udfPath: g,
                args: [Re(s)],
                journal: r,
                componentPath: h
            };
            return this.paused ? this.pendingQuerySetModifications.set(T, z) : this.querySetVersion = Z,
            {
                queryToken: E,
                modification: {
                    type: "ModifyQuerySet",
                    baseVersion: D,
                    newVersion: Z,
                    modifications: [z]
                },
                unsubscribe: () => this.removeSubscriber(E)
            }
        }
    }
    transition(i) {
        for (const s of i.modifications)
            switch (s.type) {
            case "QueryUpdated":
            case "QueryFailed":
                {
                    this.outstandingQueriesOlderThanRestart.delete(s.queryId);
                    const r = s.journal;
                    if (r !== void 0) {
                        const h = this.queryIdToToken.get(s.queryId);
                        h !== void 0 && (this.querySet.get(h).journal = r)
                    }
                    break
                }
            case "QueryRemoved":
                {
                    this.outstandingQueriesOlderThanRestart.delete(s.queryId);
                    break
                }
            default:
                throw new Error(`Invalid modification ${s.type}`)
            }
    }
    queryId(i, s) {
        const r = gi(i)
          , h = In(r, s)
          , g = this.querySet.get(h);
        return g !== void 0 ? g.id : null
    }
    isCurrentOrNewerAuthVersion(i) {
        return i >= this.identityVersion
    }
    setAuth(i) {
        this.auth = {
            tokenType: "User",
            value: i
        };
        const s = this.identityVersion;
        return this.paused || (this.identityVersion = s + 1),
        {
            type: "Authenticate",
            baseVersion: s,
            ...this.auth
        }
    }
    setAdminAuth(i, s) {
        const r = {
            tokenType: "Admin",
            value: i,
            impersonating: s
        };
        this.auth = r;
        const h = this.identityVersion;
        return this.paused || (this.identityVersion = h + 1),
        {
            type: "Authenticate",
            baseVersion: h,
            ...r
        }
    }
    clearAuth() {
        this.auth = void 0,
        this.markAuthCompletion();
        const i = this.identityVersion;
        return this.paused || (this.identityVersion = i + 1),
        {
            type: "Authenticate",
            tokenType: "None",
            baseVersion: i
        }
    }
    hasAuth() {
        return !!this.auth
    }
    isNewAuth(i) {
        var s;
        return ((s = this.auth) == null ? void 0 : s.value) !== i
    }
    queryPath(i) {
        const s = this.queryIdToToken.get(i);
        return s ? this.querySet.get(s).canonicalizedUdfPath : null
    }
    queryArgs(i) {
        const s = this.queryIdToToken.get(i);
        return s ? this.querySet.get(s).args : null
    }
    queryToken(i) {
        return this.queryIdToToken.get(i) ?? null
    }
    queryJournal(i) {
        var s;
        return (s = this.querySet.get(i)) == null ? void 0 : s.journal
    }
    restart(i) {
        this.unpause(),
        this.outstandingQueriesOlderThanRestart.clear();
        const s = [];
        for (const g of this.querySet.values()) {
            const E = {
                type: "Add",
                queryId: g.id,
                udfPath: g.canonicalizedUdfPath,
                args: [Re(g.args)],
                journal: g.journal,
                componentPath: g.componentPath
            };
            s.push(E),
            i.has(g.id) || this.outstandingQueriesOlderThanRestart.add(g.id)
        }
        this.querySetVersion = 1;
        const r = {
            type: "ModifyQuerySet",
            baseVersion: 0,
            newVersion: 1,
            modifications: s
        };
        if (!this.auth)
            return this.identityVersion = 0,
            [r, void 0];
        this.outstandingAuthOlderThanRestart = !0;
        const h = {
            type: "Authenticate",
            baseVersion: 0,
            ...this.auth
        };
        return this.identityVersion = 1,
        [r, h]
    }
    pause() {
        this.paused = !0
    }
    resume() {
        const i = this.pendingQuerySetModifications.size > 0 ? {
            type: "ModifyQuerySet",
            baseVersion: this.querySetVersion,
            newVersion: ++this.querySetVersion,
            modifications: Array.from(this.pendingQuerySetModifications.values())
        } : void 0
          , s = this.auth !== void 0 ? {
            type: "Authenticate",
            baseVersion: this.identityVersion++,
            ...this.auth
        } : void 0;
        return this.unpause(),
        [i, s]
    }
    unpause() {
        this.paused = !1,
        this.pendingQuerySetModifications.clear()
    }
    removeSubscriber(i) {
        const s = this.querySet.get(i);
        if (s.numSubscribers > 1)
            return s.numSubscribers -= 1,
            null;
        {
            this.querySet.delete(i),
            this.queryIdToToken.delete(s.id),
            this.outstandingQueriesOlderThanRestart.delete(s.id);
            const r = this.querySetVersion
              , h = this.querySetVersion + 1
              , g = {
                type: "Remove",
                queryId: s.id
            };
            return this.paused ? this.pendingQuerySetModifications.has(s.id) ? this.pendingQuerySetModifications.delete(s.id) : this.pendingQuerySetModifications.set(s.id, g) : this.querySetVersion = h,
            {
                type: "ModifyQuerySet",
                baseVersion: r,
                newVersion: h,
                modifications: [g]
            }
        }
    }
}
var kv = Object.defineProperty
  , Zv = (c, i, s) => i in c ? kv(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , ci = (c, i, s) => Zv(c, typeof i != "symbol" ? i + "" : i, s);
class Kv {
    constructor(i) {
        this.logger = i,
        ci(this, "inflightRequests"),
        ci(this, "requestsOlderThanRestart"),
        ci(this, "inflightMutationsCount", 0),
        ci(this, "inflightActionsCount", 0),
        this.inflightRequests = new Map,
        this.requestsOlderThanRestart = new Set
    }
    request(i, s) {
        return new Promise(h => {
            const g = s ? "Requested" : "NotSent";
            this.inflightRequests.set(i.requestId, {
                message: i,
                status: {
                    status: g,
                    requestedAt: new Date,
                    onResult: h
                }
            }),
            i.type === "Mutation" ? this.inflightMutationsCount++ : i.type === "Action" && this.inflightActionsCount++
        }
        )
    }
    onResponse(i) {
        const s = this.inflightRequests.get(i.requestId);
        if (s === void 0 || s.status.status === "Completed")
            return null;
        const r = s.message.type === "Mutation" ? "mutation" : "action"
          , h = s.message.udfPath;
        for (const T of i.logLines)
            xn(this.logger, "info", r, h, T);
        const g = s.status;
        let E, x;
        if (i.success)
            E = {
                success: !0,
                logLines: i.logLines,
                value: xe(i.result)
            },
            x = () => g.onResult(E);
        else {
            const T = i.result
              , {errorData: b} = i;
            xn(this.logger, "error", r, h, T),
            E = {
                success: !1,
                errorMessage: T,
                errorData: b !== void 0 ? xe(b) : void 0,
                logLines: i.logLines
            },
            x = () => g.onResult(E)
        }
        return i.type === "ActionResponse" || !i.success ? (x(),
        this.inflightRequests.delete(i.requestId),
        this.requestsOlderThanRestart.delete(i.requestId),
        s.message.type === "Action" ? this.inflightActionsCount-- : s.message.type === "Mutation" && this.inflightMutationsCount--,
        {
            requestId: i.requestId,
            result: E
        }) : (s.status = {
            status: "Completed",
            result: E,
            ts: i.ts,
            onResolve: x
        },
        null)
    }
    removeCompleted(i) {
        const s = new Map;
        for (const [r,h] of this.inflightRequests.entries()) {
            const g = h.status;
            g.status === "Completed" && g.ts.lessThanOrEqual(i) && (g.onResolve(),
            s.set(r, g.result),
            h.message.type === "Mutation" ? this.inflightMutationsCount-- : h.message.type === "Action" && this.inflightActionsCount--,
            this.inflightRequests.delete(r),
            this.requestsOlderThanRestart.delete(r))
        }
        return s
    }
    restart() {
        this.requestsOlderThanRestart = new Set(this.inflightRequests.keys());
        const i = [];
        for (const [s,r] of this.inflightRequests) {
            if (r.status.status === "NotSent") {
                r.status.status = "Requested",
                i.push(r.message);
                continue
            }
            if (r.message.type === "Mutation")
                i.push(r.message);
            else if (r.message.type === "Action") {
                if (this.inflightRequests.delete(s),
                this.requestsOlderThanRestart.delete(s),
                this.inflightActionsCount--,
                r.status.status === "Completed")
                    throw new Error("Action should never be in 'Completed' state");
                r.status.onResult({
                    success: !1,
                    errorMessage: "Connection lost while action was in flight",
                    logLines: []
                })
            }
        }
        return i
    }
    resume() {
        const i = [];
        for (const [,s] of this.inflightRequests)
            if (s.status.status === "NotSent") {
                s.status.status = "Requested",
                i.push(s.message);
                continue
            }
        return i
    }
    hasIncompleteRequests() {
        for (const i of this.inflightRequests.values())
            if (i.status.status === "Requested")
                return !0;
        return !1
    }
    hasInflightRequests() {
        return this.inflightRequests.size > 0
    }
    hasSyncedPastLastReconnect() {
        return this.requestsOlderThanRestart.size === 0
    }
    timeOfOldestInflightRequest() {
        if (this.inflightRequests.size === 0)
            return null;
        let i = Date.now();
        for (const s of this.inflightRequests.values())
            s.status.status !== "Completed" && s.status.requestedAt.getTime() < i && (i = s.status.requestedAt.getTime());
        return new Date(i)
    }
    inflightMutations() {
        return this.inflightMutationsCount
    }
    inflightActions() {
        return this.inflightActionsCount
    }
}
const ka = Symbol.for("functionName")
  , Od = Symbol.for("toReferencePath");
function Jv(c) {
    return c[Od] ?? null
}
function $v(c) {
    return c.startsWith("function://")
}
function Wv(c) {
    let i;
    if (typeof c == "string")
        $v(c) ? i = {
            functionHandle: c
        } : i = {
            name: c
        };
    else if (c[ka])
        i = {
            name: c[ka]
        };
    else {
        const s = Jv(c);
        if (!s)
            throw new Error(`${c} is not a functionReference`);
        i = {
            reference: s
        }
    }
    return i
}
function Vt(c) {
    const i = Wv(c);
    if (i.name === void 0)
        throw i.functionHandle !== void 0 ? new Error(`Expected function reference like "api.file.func" or "internal.file.func", but received function handle ${i.functionHandle}`) : i.reference !== void 0 ? new Error(`Expected function reference in the current component like "api.file.func" or "internal.file.func", but received reference ${i.reference}`) : new Error(`Expected function reference like "api.file.func" or "internal.file.func", but received ${JSON.stringify(i)}`);
    if (typeof c == "string")
        return c;
    const s = c[ka];
    if (!s)
        throw new Error(`${c} is not a functionReference`);
    return s
}
function Md(c) {
    return {
        [ka]: c
    }
}
function wd(c=[]) {
    const i = {
        get(s, r) {
            if (typeof r == "string") {
                const h = [...c, r];
                return wd(h)
            } else if (r === ka) {
                if (c.length < 2) {
                    const E = ["api", ...c].join(".");
                    throw new Error(`API path is expected to be of the form \`api.moduleName.functionName\`. Found: \`${E}\``)
                }
                const h = c.slice(0, -1).join("/")
                  , g = c[c.length - 1];
                return g === "default" ? h : h + ":" + g
            } else
                return r === Symbol.toStringTag ? "FunctionReference" : void 0
        }
    };
    return new Proxy({},i)
}
const Fv = wd();
var Iv = Object.defineProperty
  , Pv = (c, i, s) => i in c ? Iv(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , vi = (c, i, s) => Pv(c, typeof i != "symbol" ? i + "" : i, s);
class Za {
    constructor(i) {
        vi(this, "queryResults"),
        vi(this, "modifiedQueries"),
        this.queryResults = i,
        this.modifiedQueries = []
    }
    getQuery(i, ...s) {
        const r = ne(s[0])
          , h = Vt(i)
          , g = this.queryResults.get(In(h, r));
        if (g !== void 0)
            return Za.queryValue(g.result)
    }
    getAllQueries(i) {
        const s = []
          , r = Vt(i);
        for (const h of this.queryResults.values())
            h.udfPath === gi(r) && s.push({
                args: h.args,
                value: Za.queryValue(h.result)
            });
        return s
    }
    setQuery(i, s, r) {
        const h = ne(s)
          , g = Vt(i)
          , E = In(g, h);
        let x;
        r === void 0 ? x = void 0 : x = {
            success: !0,
            value: r,
            logLines: []
        };
        const T = {
            udfPath: g,
            args: h,
            result: x
        };
        this.queryResults.set(E, T),
        this.modifiedQueries.push(E)
    }
    static queryValue(i) {
        if (i !== void 0)
            return i.success ? i.value : void 0
    }
}
class tm {
    constructor() {
        vi(this, "queryResults"),
        vi(this, "optimisticUpdates"),
        this.queryResults = new Map,
        this.optimisticUpdates = []
    }
    ingestQueryResultsFromServer(i, s) {
        this.optimisticUpdates = this.optimisticUpdates.filter(E => !s.has(E.mutationId));
        const r = this.queryResults;
        this.queryResults = new Map(i);
        const h = new Za(this.queryResults);
        for (const E of this.optimisticUpdates)
            E.update(h);
        const g = [];
        for (const [E,x] of this.queryResults) {
            const T = r.get(E);
            (T === void 0 || T.result !== x.result) && g.push(E)
        }
        return g
    }
    applyOptimisticUpdate(i, s) {
        this.optimisticUpdates.push({
            update: i,
            mutationId: s
        });
        const r = new Za(this.queryResults);
        return i(r),
        r.modifiedQueries
    }
    queryResult(i) {
        const s = this.queryResults.get(i);
        if (s === void 0)
            return;
        const r = s.result;
        if (r !== void 0) {
            if (r.success)
                return r.value;
            throw r.errorData !== void 0 ? $c(r, new Fn(Ll("query", s.udfPath, r))) : new Error(Ll("query", s.udfPath, r))
        }
    }
    hasQueryResult(i) {
        return this.queryResults.get(i) !== void 0
    }
    queryLogs(i) {
        var r;
        const s = this.queryResults.get(i);
        return (r = s == null ? void 0 : s.result) == null ? void 0 : r.logLines
    }
}
var em = Object.defineProperty
  , nm = (c, i, s) => i in c ? em(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , Vc = (c, i, s) => nm(c, typeof i != "symbol" ? i + "" : i, s);
class de {
    constructor(i, s) {
        Vc(this, "low"),
        Vc(this, "high"),
        Vc(this, "__isUnsignedLong__"),
        this.low = i | 0,
        this.high = s | 0,
        this.__isUnsignedLong__ = !0
    }
    static isLong(i) {
        return (i && i.__isUnsignedLong__) === !0
    }
    static fromBytesLE(i) {
        return new de(i[0] | i[1] << 8 | i[2] << 16 | i[3] << 24,i[4] | i[5] << 8 | i[6] << 16 | i[7] << 24)
    }
    toBytesLE() {
        const i = this.high
          , s = this.low;
        return [s & 255, s >>> 8 & 255, s >>> 16 & 255, s >>> 24, i & 255, i >>> 8 & 255, i >>> 16 & 255, i >>> 24]
    }
    static fromNumber(i) {
        return isNaN(i) || i < 0 ? rd : i >= lm ? am : new de(i % Ya | 0,i / Ya | 0)
    }
    toString() {
        return (BigInt(this.high) * BigInt(Ya) + BigInt(this.low)).toString()
    }
    equals(i) {
        return de.isLong(i) || (i = de.fromValue(i)),
        this.high >>> 31 === 1 && i.high >>> 31 === 1 ? !1 : this.high === i.high && this.low === i.low
    }
    notEquals(i) {
        return !this.equals(i)
    }
    comp(i) {
        return de.isLong(i) || (i = de.fromValue(i)),
        this.equals(i) ? 0 : i.high >>> 0 > this.high >>> 0 || i.high === this.high && i.low >>> 0 > this.low >>> 0 ? -1 : 1
    }
    lessThanOrEqual(i) {
        return this.comp(i) <= 0
    }
    static fromValue(i) {
        return typeof i == "number" ? de.fromNumber(i) : new de(i.low,i.high)
    }
}
const rd = new de(0,0)
  , od = 65536
  , Ya = od * od
  , lm = Ya * Ya
  , am = new de(-1,-1);
var um = Object.defineProperty
  , im = (c, i, s) => i in c ? um(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , ri = (c, i, s) => im(c, typeof i != "symbol" ? i + "" : i, s);
class fd {
    constructor(i, s) {
        ri(this, "version"),
        ri(this, "remoteQuerySet"),
        ri(this, "queryPath"),
        ri(this, "logger"),
        this.version = {
            querySet: 0,
            ts: de.fromNumber(0),
            identity: 0
        },
        this.remoteQuerySet = new Map,
        this.queryPath = i,
        this.logger = s
    }
    transition(i) {
        const s = i.startVersion;
        if (this.version.querySet !== s.querySet || this.version.ts.notEquals(s.ts) || this.version.identity !== s.identity)
            throw new Error(`Invalid start version: ${s.ts.toString()}:${s.querySet}`);
        for (const r of i.modifications)
            switch (r.type) {
            case "QueryUpdated":
                {
                    const h = this.queryPath(r.queryId);
                    if (h)
                        for (const E of r.logLines)
                            xn(this.logger, "info", "query", h, E);
                    const g = xe(r.value ?? null);
                    this.remoteQuerySet.set(r.queryId, {
                        success: !0,
                        value: g,
                        logLines: r.logLines
                    });
                    break
                }
            case "QueryFailed":
                {
                    const h = this.queryPath(r.queryId);
                    if (h)
                        for (const E of r.logLines)
                            xn(this.logger, "info", "query", h, E);
                    const {errorData: g} = r;
                    this.remoteQuerySet.set(r.queryId, {
                        success: !1,
                        errorMessage: r.errorMessage,
                        errorData: g !== void 0 ? xe(g) : void 0,
                        logLines: r.logLines
                    });
                    break
                }
            case "QueryRemoved":
                {
                    this.remoteQuerySet.delete(r.queryId);
                    break
                }
            default:
                throw new Error(`Invalid modification ${r.type}`)
            }
        this.version = i.endVersion
    }
    remoteQueryResults() {
        return this.remoteQuerySet
    }
    timestamp() {
        return this.version.ts
    }
}
function Yc(c) {
    const i = Ga(c);
    return de.fromBytesLE(Array.from(i))
}
function sm(c) {
    const i = new Uint8Array(c.toBytesLE());
    return Xa(i)
}
function cm(c) {
    switch (c.type) {
    case "FatalError":
    case "AuthError":
    case "ActionResponse":
    case "Ping":
        return {
            ...c
        };
    case "MutationResponse":
        return c.success ? {
            ...c,
            ts: Yc(c.ts)
        } : {
            ...c
        };
    case "Transition":
        return {
            ...c,
            startVersion: {
                ...c.startVersion,
                ts: Yc(c.startVersion.ts)
            },
            endVersion: {
                ...c.endVersion,
                ts: Yc(c.endVersion.ts)
            }
        }
    }
}
function rm(c) {
    switch (c.type) {
    case "Authenticate":
    case "ModifyQuerySet":
    case "Mutation":
    case "Action":
    case "Event":
        return {
            ...c
        };
    case "Connect":
        return c.maxObservedTimestamp !== void 0 ? {
            ...c,
            maxObservedTimestamp: sm(c.maxObservedTimestamp)
        } : {
            ...c,
            maxObservedTimestamp: void 0
        }
    }
}
var om = Object.defineProperty
  , fm = (c, i, s) => i in c ? om(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , Jt = (c, i, s) => fm(c, typeof i != "symbol" ? i + "" : i, s);
const hm = 1e3
  , dm = 1001
  , ym = 1005
  , gm = 4040
  , qd = {
    InternalServerError: {
        timeout: 1e3
    },
    SubscriptionsWorkerFullError: {
        timeout: 3e3
    },
    TooManyConcurrentRequests: {
        timeout: 3e3
    },
    CommitterFullError: {
        timeout: 3e3
    },
    AwsTooManyRequestsException: {
        timeout: 3e3
    },
    ExecuteFullError: {
        timeout: 3e3
    },
    SystemTimeoutError: {
        timeout: 3e3
    },
    ExpiredInQueue: {
        timeout: 3e3
    },
    VectorIndexesUnavailable: {
        timeout: 1e3
    },
    SearchIndexesUnavailable: {
        timeout: 1e3
    },
    VectorIndexTooLarge: {
        timeout: 3e3
    },
    SearchIndexTooLarge: {
        timeout: 3e3
    },
    TooManyWritesInTimePeriod: {
        timeout: 3e3
    }
};
function vm(c) {
    if (c === void 0)
        return "Unknown";
    for (const i of Object.keys(qd))
        if (c.startsWith(i))
            return i;
    return "Unknown"
}
class mm {
    constructor(i, s, r, h) {
        Jt(this, "socket"),
        Jt(this, "connectionCount"),
        Jt(this, "_hasEverConnected", !1),
        Jt(this, "lastCloseReason"),
        Jt(this, "defaultInitialBackoff"),
        Jt(this, "maxBackoff"),
        Jt(this, "retries"),
        Jt(this, "serverInactivityThreshold"),
        Jt(this, "reconnectDueToServerInactivityTimeout"),
        Jt(this, "uri"),
        Jt(this, "onOpen"),
        Jt(this, "onResume"),
        Jt(this, "onMessage"),
        Jt(this, "webSocketConstructor"),
        Jt(this, "logger"),
        this.webSocketConstructor = r,
        this.socket = {
            state: "disconnected"
        },
        this.connectionCount = 0,
        this.lastCloseReason = "InitialConnect",
        this.defaultInitialBackoff = 1e3,
        this.maxBackoff = 16e3,
        this.retries = 0,
        this.serverInactivityThreshold = 3e4,
        this.reconnectDueToServerInactivityTimeout = null,
        this.uri = i,
        this.onOpen = s.onOpen,
        this.onResume = s.onResume,
        this.onMessage = s.onMessage,
        this.logger = h,
        this.connect()
    }
    setSocketState(i) {
        this.socket = i,
        this._logVerbose(`socket state changed: ${this.socket.state}, paused: ${"paused"in this.socket ? this.socket.paused : void 0}`)
    }
    connect() {
        if (this.socket.state === "terminated")
            return;
        if (this.socket.state !== "disconnected" && this.socket.state !== "stopped")
            throw new Error("Didn't start connection from disconnected state: " + this.socket.state);
        const i = new this.webSocketConstructor(this.uri);
        this._logVerbose("constructed WebSocket"),
        this.setSocketState({
            state: "connecting",
            ws: i,
            paused: "no"
        }),
        this.resetServerInactivityTimeout(),
        i.onopen = () => {
            if (this.logger.logVerbose("begin ws.onopen"),
            this.socket.state !== "connecting")
                throw new Error("onopen called with socket not in connecting state");
            this.setSocketState({
                state: "ready",
                ws: i,
                paused: this.socket.paused === "yes" ? "uninitialized" : "no"
            }),
            this.resetServerInactivityTimeout(),
            this.socket.paused === "no" && (this._hasEverConnected = !0,
            this.onOpen({
                connectionCount: this.connectionCount,
                lastCloseReason: this.lastCloseReason
            })),
            this.lastCloseReason !== "InitialConnect" && this.logger.log("WebSocket reconnected"),
            this.connectionCount += 1,
            this.lastCloseReason = null
        }
        ,
        i.onerror = s => {
            const r = s.message;
            this.logger.log(`WebSocket error: ${r}`)
        }
        ,
        i.onmessage = s => {
            this.resetServerInactivityTimeout();
            const r = cm(JSON.parse(s.data));
            this._logVerbose(`received ws message with type ${r.type}`),
            this.onMessage(r).hasSyncedPastLastReconnect && (this.retries = 0)
        }
        ,
        i.onclose = s => {
            if (this._logVerbose("begin ws.onclose"),
            this.lastCloseReason === null && (this.lastCloseReason = s.reason ?? "OnCloseInvoked"),
            s.code !== hm && s.code !== dm && s.code !== ym && s.code !== gm) {
                let h = `WebSocket closed with code ${s.code}`;
                s.reason && (h += `: ${s.reason}`),
                this.logger.log(h)
            }
            const r = vm(s.reason);
            this.scheduleReconnect(r)
        }
    }
    socketState() {
        return this.socket.state
    }
    sendMessage(i) {
        const s = {
            type: i.type,
            ...i.type === "Authenticate" && i.tokenType === "User" ? {
                value: `...${i.value.slice(-7)}`
            } : {}
        };
        if (this.socket.state === "ready" && this.socket.paused === "no") {
            const r = rm(i)
              , h = JSON.stringify(r);
            try {
                this.socket.ws.send(h)
            } catch (g) {
                this.logger.log(`Failed to send message on WebSocket, reconnecting: ${g}`),
                this.closeAndReconnect("FailedToSendMessage")
            }
            return this._logVerbose(`sent message with type ${i.type}: ${JSON.stringify(s)}`),
            !0
        }
        return this._logVerbose(`message not sent (socket state: ${this.socket.state}, paused: ${"paused"in this.socket ? this.socket.paused : void 0}): ${JSON.stringify(s)}`),
        !1
    }
    resetServerInactivityTimeout() {
        this.socket.state !== "terminated" && (this.reconnectDueToServerInactivityTimeout !== null && (clearTimeout(this.reconnectDueToServerInactivityTimeout),
        this.reconnectDueToServerInactivityTimeout = null),
        this.reconnectDueToServerInactivityTimeout = setTimeout( () => {
            this.closeAndReconnect("InactiveServer")
        }
        , this.serverInactivityThreshold))
    }
    scheduleReconnect(i) {
        this.socket = {
            state: "disconnected"
        };
        const s = this.nextBackoff(i);
        this.logger.log(`Attempting reconnect in ${s}ms`),
        setTimeout( () => this.connect(), s)
    }
    closeAndReconnect(i) {
        switch (this._logVerbose(`begin closeAndReconnect with reason ${i}`),
        this.socket.state) {
        case "disconnected":
        case "terminated":
        case "stopped":
            return;
        case "connecting":
        case "ready":
            {
                this.lastCloseReason = i,
                this.close(),
                this.scheduleReconnect("client");
                return
            }
        default:
            this.socket
        }
    }
    close() {
        switch (this.socket.state) {
        case "disconnected":
        case "terminated":
        case "stopped":
            return Promise.resolve();
        case "connecting":
            {
                const i = this.socket.ws;
                return new Promise(s => {
                    i.onclose = () => {
                        this._logVerbose("Closed after connecting"),
                        s()
                    }
                    ,
                    i.onopen = () => {
                        this._logVerbose("Opened after connecting"),
                        i.close()
                    }
                }
                )
            }
        case "ready":
            {
                this._logVerbose("ws.close called");
                const i = this.socket.ws
                  , s = new Promise(r => {
                    i.onclose = () => {
                        r()
                    }
                }
                );
                return i.close(),
                s
            }
        default:
            return this.socket,
            Promise.resolve()
        }
    }
    terminate() {
        switch (this.reconnectDueToServerInactivityTimeout && clearTimeout(this.reconnectDueToServerInactivityTimeout),
        this.socket.state) {
        case "terminated":
        case "stopped":
        case "disconnected":
        case "connecting":
        case "ready":
            {
                const i = this.close();
                return this.setSocketState({
                    state: "terminated"
                }),
                i
            }
        default:
            throw this.socket,
            new Error(`Invalid websocket state: ${this.socket.state}`)
        }
    }
    stop() {
        switch (this.socket.state) {
        case "terminated":
            return Promise.resolve();
        case "connecting":
        case "stopped":
        case "disconnected":
        case "ready":
            {
                const i = this.close();
                return this.socket = {
                    state: "stopped"
                },
                i
            }
        default:
            return this.socket,
            Promise.resolve()
        }
    }
    tryRestart() {
        switch (this.socket.state) {
        case "stopped":
            break;
        case "terminated":
        case "connecting":
        case "ready":
        case "disconnected":
            this.logger.logVerbose("Restart called without stopping first");
            return;
        default:
            this.socket
        }
        this.connect()
    }
    pause() {
        switch (this.socket.state) {
        case "disconnected":
        case "stopped":
        case "terminated":
            return;
        case "connecting":
        case "ready":
            {
                this.socket = {
                    ...this.socket,
                    paused: "yes"
                };
                return
            }
        default:
            {
                this.socket;
                return
            }
        }
    }
    resume() {
        switch (this.socket.state) {
        case "connecting":
            this.socket = {
                ...this.socket,
                paused: "no"
            };
            return;
        case "ready":
            this.socket.paused === "uninitialized" ? (this.socket = {
                ...this.socket,
                paused: "no"
            },
            this.onOpen({
                connectionCount: this.connectionCount,
                lastCloseReason: this.lastCloseReason
            })) : this.socket.paused === "yes" && (this.socket = {
                ...this.socket,
                paused: "no"
            },
            this.onResume());
            return;
        case "terminated":
        case "stopped":
        case "disconnected":
            return;
        default:
            this.socket
        }
        this.connect()
    }
    connectionState() {
        return {
            isConnected: this.socket.state === "ready",
            hasEverConnected: this._hasEverConnected,
            connectionCount: this.connectionCount,
            connectionRetries: this.retries
        }
    }
    _logVerbose(i) {
        this.logger.logVerbose(i)
    }
    nextBackoff(i) {
        const r = (i === "client" ? 100 : i === "Unknown" ? this.defaultInitialBackoff : qd[i].timeout) * Math.pow(2, this.retries);
        this.retries += 1;
        const h = Math.min(r, this.maxBackoff)
          , g = h * (Math.random() - .5);
        return h + g
    }
}
function Sm() {
    return bm()
}
function bm() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const i = Math.random() * 16 | 0;
        return (c === "x" ? i : i & 3 | 8).toString(16)
    }
    )
}
class ja extends Error {
}
ja.prototype.name = "InvalidTokenError";
function pm(c) {
    return decodeURIComponent(atob(c).replace(/(.)/g, (i, s) => {
        let r = s.charCodeAt(0).toString(16).toUpperCase();
        return r.length < 2 && (r = "0" + r),
        "%" + r
    }
    ))
}
function Tm(c) {
    let i = c.replace(/-/g, "+").replace(/_/g, "/");
    switch (i.length % 4) {
    case 0:
        break;
    case 2:
        i += "==";
        break;
    case 3:
        i += "=";
        break;
    default:
        throw new Error("base64 string is not of the correct length")
    }
    try {
        return pm(i)
    } catch {
        return atob(i)
    }
}
function Am(c, i) {
    if (typeof c != "string")
        throw new ja("Invalid token specified: must be a string");
    i || (i = {});
    const s = i.header === !0 ? 0 : 1
      , r = c.split(".")[s];
    if (typeof r != "string")
        throw new ja(`Invalid token specified: missing part #${s + 1}`);
    let h;
    try {
        h = Tm(r)
    } catch (g) {
        throw new ja(`Invalid token specified: invalid base64 for part #${s + 1} (${g.message})`)
    }
    try {
        return JSON.parse(h)
    } catch (g) {
        throw new ja(`Invalid token specified: invalid json for part #${s + 1} (${g.message})`)
    }
}
var Em = Object.defineProperty
  , _m = (c, i, s) => i in c ? Em(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , Ee = (c, i, s) => _m(c, typeof i != "symbol" ? i + "" : i, s);
const Rm = 20 * 24 * 60 * 60 * 1e3
  , hd = 2;
class Om {
    constructor(i, s, r) {
        Ee(this, "authState", {
            state: "noAuth"
        }),
        Ee(this, "configVersion", 0),
        Ee(this, "syncState"),
        Ee(this, "authenticate"),
        Ee(this, "stopSocket"),
        Ee(this, "tryRestartSocket"),
        Ee(this, "pauseSocket"),
        Ee(this, "resumeSocket"),
        Ee(this, "clearAuth"),
        Ee(this, "logger"),
        Ee(this, "refreshTokenLeewaySeconds"),
        Ee(this, "tokenConfirmationAttempts", 0),
        this.syncState = i,
        this.authenticate = s.authenticate,
        this.stopSocket = s.stopSocket,
        this.tryRestartSocket = s.tryRestartSocket,
        this.pauseSocket = s.pauseSocket,
        this.resumeSocket = s.resumeSocket,
        this.clearAuth = s.clearAuth,
        this.logger = r.logger,
        this.refreshTokenLeewaySeconds = r.refreshTokenLeewaySeconds
    }
    async setConfig(i, s) {
        this.resetAuthState(),
        this._logVerbose("pausing WS for auth token fetch"),
        this.pauseSocket();
        const r = await this.fetchTokenAndGuardAgainstRace(i, {
            forceRefreshToken: !1
        });
        r.isFromOutdatedConfig || (r.value ? (this.setAuthState({
            state: "waitingForServerConfirmationOfCachedToken",
            config: {
                fetchToken: i,
                onAuthChange: s
            },
            hasRetried: !1
        }),
        this.authenticate(r.value)) : (this.setAuthState({
            state: "initialRefetch",
            config: {
                fetchToken: i,
                onAuthChange: s
            }
        }),
        await this.refetchToken()),
        this._logVerbose("resuming WS after auth token fetch"),
        this.resumeSocket())
    }
    onTransition(i) {
        if (this.syncState.isCurrentOrNewerAuthVersion(i.endVersion.identity) && !(i.endVersion.identity <= i.startVersion.identity)) {
            if (this.authState.state === "waitingForServerConfirmationOfCachedToken") {
                this._logVerbose("server confirmed auth token is valid"),
                this.refetchToken(),
                this.authState.config.onAuthChange(!0);
                return
            }
            this.authState.state === "waitingForServerConfirmationOfFreshToken" && (this._logVerbose("server confirmed new auth token is valid"),
            this.scheduleTokenRefetch(this.authState.token),
            this.tokenConfirmationAttempts = 0,
            this.authState.hadAuth || this.authState.config.onAuthChange(!0))
        }
    }
    onAuthError(i) {
        if (i.authUpdateAttempted === !1 && (this.authState.state === "waitingForServerConfirmationOfFreshToken" || this.authState.state === "waitingForServerConfirmationOfCachedToken")) {
            this._logVerbose("ignoring non-auth token expired error");
            return
        }
        const {baseVersion: s} = i;
        if (!this.syncState.isCurrentOrNewerAuthVersion(s + 1)) {
            this._logVerbose("ignoring auth error for previous auth attempt");
            return
        }
        this.tryToReauthenticate(i)
    }
    async tryToReauthenticate(i) {
        if (this._logVerbose(`attempting to reauthenticate: ${i.error}`),
        this.authState.state === "noAuth" || this.authState.state === "waitingForServerConfirmationOfFreshToken" && this.tokenConfirmationAttempts >= hd) {
            this.logger.error(`Failed to authenticate: "${i.error}", check your server auth config`),
            this.syncState.hasAuth() && this.syncState.clearAuth(),
            this.authState.state !== "noAuth" && this.setAndReportAuthFailed(this.authState.config.onAuthChange);
            return
        }
        this.authState.state === "waitingForServerConfirmationOfFreshToken" && (this.tokenConfirmationAttempts++,
        this._logVerbose(`retrying reauthentication, ${hd - this.tokenConfirmationAttempts} attempts remaining`)),
        await this.stopSocket();
        const s = await this.fetchTokenAndGuardAgainstRace(this.authState.config.fetchToken, {
            forceRefreshToken: !0
        });
        s.isFromOutdatedConfig || (s.value && this.syncState.isNewAuth(s.value) ? (this.authenticate(s.value),
        this.setAuthState({
            state: "waitingForServerConfirmationOfFreshToken",
            config: this.authState.config,
            token: s.value,
            hadAuth: this.authState.state === "notRefetching" || this.authState.state === "waitingForScheduledRefetch"
        })) : (this._logVerbose("reauthentication failed, could not fetch a new token"),
        this.syncState.hasAuth() && this.syncState.clearAuth(),
        this.setAndReportAuthFailed(this.authState.config.onAuthChange)),
        this.tryRestartSocket())
    }
    async refetchToken() {
        if (this.authState.state === "noAuth")
            return;
        this._logVerbose("refetching auth token");
        const i = await this.fetchTokenAndGuardAgainstRace(this.authState.config.fetchToken, {
            forceRefreshToken: !0
        });
        i.isFromOutdatedConfig || (i.value ? this.syncState.isNewAuth(i.value) ? (this.setAuthState({
            state: "waitingForServerConfirmationOfFreshToken",
            hadAuth: this.syncState.hasAuth(),
            token: i.value,
            config: this.authState.config
        }),
        this.authenticate(i.value)) : this.setAuthState({
            state: "notRefetching",
            config: this.authState.config
        }) : (this._logVerbose("refetching token failed"),
        this.syncState.hasAuth() && this.clearAuth(),
        this.setAndReportAuthFailed(this.authState.config.onAuthChange)),
        this._logVerbose("restarting WS after auth token fetch (if currently stopped)"),
        this.tryRestartSocket())
    }
    scheduleTokenRefetch(i) {
        if (this.authState.state === "noAuth")
            return;
        const s = this.decodeToken(i);
        if (!s) {
            this.logger.error("Auth token is not a valid JWT, cannot refetch the token");
            return
        }
        const {iat: r, exp: h} = s;
        if (!r || !h) {
            this.logger.error("Auth token does not have required fields, cannot refetch the token");
            return
        }
        const g = h - r;
        if (g <= 2) {
            this.logger.error("Auth token does not live long enough, cannot refetch the token");
            return
        }
        let E = Math.min(Rm, (g - this.refreshTokenLeewaySeconds) * 1e3);
        E <= 0 && (this.logger.warn(`Refetching auth token immediately, configured leeway ${this.refreshTokenLeewaySeconds}s is larger than the token's lifetime ${g}s`),
        E = 0);
        const x = setTimeout( () => {
            this._logVerbose("running scheduled token refetch"),
            this.refetchToken()
        }
        , E);
        this.setAuthState({
            state: "waitingForScheduledRefetch",
            refetchTokenTimeoutId: x,
            config: this.authState.config
        }),
        this._logVerbose(`scheduled preemptive auth token refetching in ${E}ms`)
    }
    async fetchTokenAndGuardAgainstRace(i, s) {
        const r = ++this.configVersion;
        this._logVerbose(`fetching token with config version ${r}`);
        const h = await i(s);
        return this.configVersion !== r ? (this._logVerbose(`stale config version, expected ${r}, got ${this.configVersion}`),
        {
            isFromOutdatedConfig: !0
        }) : {
            isFromOutdatedConfig: !1,
            value: h
        }
    }
    stop() {
        this.resetAuthState(),
        this.configVersion++,
        this._logVerbose(`config version bumped to ${this.configVersion}`)
    }
    setAndReportAuthFailed(i) {
        i(!1),
        this.resetAuthState()
    }
    resetAuthState() {
        this.setAuthState({
            state: "noAuth"
        })
    }
    setAuthState(i) {
        const s = i.state === "waitingForServerConfirmationOfFreshToken" ? {
            hadAuth: i.hadAuth,
            state: i.state,
            token: `...${i.token.slice(-7)}`
        } : {
            state: i.state
        };
        switch (this._logVerbose(`setting auth state to ${JSON.stringify(s)}`),
        i.state) {
        case "waitingForScheduledRefetch":
        case "notRefetching":
        case "noAuth":
            this.tokenConfirmationAttempts = 0;
            break
        }
        this.authState.state === "waitingForScheduledRefetch" && (clearTimeout(this.authState.refetchTokenTimeoutId),
        this.syncState.markAuthCompletion()),
        this.authState = i
    }
    decodeToken(i) {
        try {
            return Am(i)
        } catch (s) {
            return this._logVerbose(`Error decoding token: ${sinstanceof Error ? s.message : "Unknown error"}`),
            null
        }
    }
    _logVerbose(i) {
        this.logger.logVerbose(`${i} [v${this.configVersion}]`)
    }
}
const Mm = ["convexClientConstructed", "convexWebSocketOpen", "convexFirstMessageReceived"];
function wm(c, i) {
    const s = {
        sessionId: i
    };
    typeof performance > "u" || !performance.mark || performance.mark(c, {
        detail: s
    })
}
function qm(c) {
    let i = c.name.slice(6);
    return i = i.charAt(0).toLowerCase() + i.slice(1),
    {
        name: i,
        startTime: c.startTime
    }
}
function xm(c) {
    if (typeof performance > "u" || !performance.getEntriesByName)
        return [];
    const i = [];
    for (const s of Mm) {
        const r = performance.getEntriesByName(s).filter(h => h.entryType === "mark").filter(h => h.detail.sessionId === c);
        i.push(...r)
    }
    return i.map(qm)
}
var Cm = Object.defineProperty
  , Dm = (c, i, s) => i in c ? Cm(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , kt = (c, i, s) => Dm(c, typeof i != "symbol" ? i + "" : i, s);
class zm {
    constructor(i, s, r) {
        if (kt(this, "address"),
        kt(this, "state"),
        kt(this, "requestManager"),
        kt(this, "webSocketManager"),
        kt(this, "authenticationManager"),
        kt(this, "remoteQuerySet"),
        kt(this, "optimisticQueryResults"),
        kt(this, "_transitionHandlerCounter", 0),
        kt(this, "_nextRequestId"),
        kt(this, "_onTransitionFns", new Map),
        kt(this, "_sessionId"),
        kt(this, "firstMessageReceived", !1),
        kt(this, "debug"),
        kt(this, "logger"),
        kt(this, "maxObservedTimestamp"),
        kt(this, "mark", z => {
            this.debug && wm(z, this.sessionId)
        }
        ),
        typeof i == "object")
            throw new Error("Passing a ClientConfig object is no longer supported. Pass the URL of the Convex deployment as a string directly.");
        (r == null ? void 0 : r.skipConvexDeploymentUrlCheck) !== !0 && Sd(i),
        r = {
            ...r
        };
        const h = r.authRefreshTokenLeewaySeconds ?? 2;
        let g = r.webSocketConstructor;
        if (!g && typeof WebSocket > "u")
            throw new Error("No WebSocket global variable defined! To use Convex in an environment without WebSocket try the HTTP client: https://docs.convex.dev/api/classes/browser.ConvexHttpClient");
        g = g || WebSocket,
        this.debug = r.reportDebugInfoToConvex ?? !1,
        this.address = i,
        this.logger = r.logger === !1 ? Pc({
            verbose: r.verbose ?? !1
        }) : r.logger !== !0 && r.logger ? r.logger : Ic({
            verbose: r.verbose ?? !1
        });
        const E = i.search("://");
        if (E === -1)
            throw new Error("Provided address was not an absolute URL.");
        const x = i.substring(E + 3)
          , T = i.substring(0, E);
        let b;
        if (T === "http")
            b = "ws";
        else if (T === "https")
            b = "wss";
        else
            throw new Error(`Unknown parent protocol ${T}`);
        const D = `${b}://${x}/api/${Wn}/sync`;
        this.state = new Xv,
        this.remoteQuerySet = new fd(z => this.state.queryPath(z),this.logger),
        this.requestManager = new Kv(this.logger),
        this.authenticationManager = new Om(this.state,{
            authenticate: z => {
                const G = this.state.setAuth(z);
                return this.webSocketManager.sendMessage(G),
                G.baseVersion
            }
            ,
            stopSocket: () => this.webSocketManager.stop(),
            tryRestartSocket: () => this.webSocketManager.tryRestart(),
            pauseSocket: () => {
                this.webSocketManager.pause(),
                this.state.pause()
            }
            ,
            resumeSocket: () => this.webSocketManager.resume(),
            clearAuth: () => {
                this.clearAuth()
            }
        },{
            logger: this.logger,
            refreshTokenLeewaySeconds: h
        }),
        this.optimisticQueryResults = new tm,
        this.addOnTransitionHandler(z => {
            s(z.queries.map(G => G.token))
        }
        ),
        this._nextRequestId = 0,
        this._sessionId = Sm();
        const {unsavedChangesWarning: Z} = r;
        if (typeof window > "u" || typeof window.addEventListener > "u") {
            if (Z === !0)
                throw new Error("unsavedChangesWarning requested, but window.addEventListener not found! Remove {unsavedChangesWarning: true} from Convex client options.")
        } else
            Z !== !1 && window.addEventListener("beforeunload", z => {
                if (this.requestManager.hasIncompleteRequests()) {
                    z.preventDefault();
                    const G = "Are you sure you want to leave? Your changes may not be saved.";
                    return (z || window.event).returnValue = G,
                    G
                }
            }
            );
        this.webSocketManager = new mm(D,{
            onOpen: z => {
                this.mark("convexWebSocketOpen"),
                this.webSocketManager.sendMessage({
                    ...z,
                    type: "Connect",
                    sessionId: this._sessionId,
                    maxObservedTimestamp: this.maxObservedTimestamp
                });
                const G = new Set(this.remoteQuerySet.remoteQueryResults().keys());
                this.remoteQuerySet = new fd(F => this.state.queryPath(F),this.logger);
                const [et,yt] = this.state.restart(G);
                yt && this.webSocketManager.sendMessage(yt),
                this.webSocketManager.sendMessage(et);
                for (const F of this.requestManager.restart())
                    this.webSocketManager.sendMessage(F)
            }
            ,
            onResume: () => {
                const [z,G] = this.state.resume();
                G && this.webSocketManager.sendMessage(G),
                z && this.webSocketManager.sendMessage(z);
                for (const et of this.requestManager.resume())
                    this.webSocketManager.sendMessage(et)
            }
            ,
            onMessage: z => {
                switch (this.firstMessageReceived || (this.firstMessageReceived = !0,
                this.mark("convexFirstMessageReceived"),
                this.reportMarks()),
                z.type) {
                case "Transition":
                    {
                        this.observedTimestamp(z.endVersion.ts),
                        this.authenticationManager.onTransition(z),
                        this.remoteQuerySet.transition(z),
                        this.state.transition(z);
                        const G = this.requestManager.removeCompleted(this.remoteQuerySet.timestamp());
                        this.notifyOnQueryResultChanges(G);
                        break
                    }
                case "MutationResponse":
                    {
                        z.success && this.observedTimestamp(z.ts);
                        const G = this.requestManager.onResponse(z);
                        G !== null && this.notifyOnQueryResultChanges(new Map([[G.requestId, G.result]]));
                        break
                    }
                case "ActionResponse":
                    {
                        this.requestManager.onResponse(z);
                        break
                    }
                case "AuthError":
                    {
                        this.authenticationManager.onAuthError(z);
                        break
                    }
                case "FatalError":
                    {
                        const G = Vv(this.logger, z.error);
                        throw this.webSocketManager.terminate(),
                        G
                    }
                }
                return {
                    hasSyncedPastLastReconnect: this.hasSyncedPastLastReconnect()
                }
            }
        },g,this.logger),
        this.mark("convexClientConstructed")
    }
    hasSyncedPastLastReconnect() {
        return this.requestManager.hasSyncedPastLastReconnect() || this.state.hasSyncedPastLastReconnect()
    }
    observedTimestamp(i) {
        (this.maxObservedTimestamp === void 0 || this.maxObservedTimestamp.lessThanOrEqual(i)) && (this.maxObservedTimestamp = i)
    }
    getMaxObservedTimestamp() {
        return this.maxObservedTimestamp
    }
    notifyOnQueryResultChanges(i) {
        const s = this.remoteQuerySet.remoteQueryResults()
          , r = new Map;
        for (const [g,E] of s) {
            const x = this.state.queryToken(g);
            if (x !== null) {
                const T = {
                    result: E,
                    udfPath: this.state.queryPath(g),
                    args: this.state.queryArgs(g)
                };
                r.set(x, T)
            }
        }
        const h = this.optimisticQueryResults.ingestQueryResultsFromServer(r, new Set(i.keys()));
        this.handleTransition({
            queries: h.map(g => ({
                token: g,
                modification: {
                    kind: "Updated",
                    result: r.get(g).result
                }
            })),
            reflectedMutations: Array.from(i).map( ([g,E]) => ({
                requestId: g,
                result: E
            })),
            timestamp: this.remoteQuerySet.timestamp()
        })
    }
    handleTransition(i) {
        for (const s of this._onTransitionFns.values())
            s(i)
    }
    addOnTransitionHandler(i) {
        const s = this._transitionHandlerCounter++;
        return this._onTransitionFns.set(s, i),
        () => this._onTransitionFns.delete(s)
    }
    setAuth(i, s) {
        this.authenticationManager.setConfig(i, s)
    }
    hasAuth() {
        return this.state.hasAuth()
    }
    setAdminAuth(i, s) {
        const r = this.state.setAdminAuth(i, s);
        this.webSocketManager.sendMessage(r)
    }
    clearAuth() {
        const i = this.state.clearAuth();
        this.webSocketManager.sendMessage(i)
    }
    subscribe(i, s, r) {
        const h = ne(s)
          , {modification: g, queryToken: E, unsubscribe: x} = this.state.subscribe(i, h, r == null ? void 0 : r.journal, r == null ? void 0 : r.componentPath);
        return g !== null && this.webSocketManager.sendMessage(g),
        {
            queryToken: E,
            unsubscribe: () => {
                const T = x();
                T && this.webSocketManager.sendMessage(T)
            }
        }
    }
    localQueryResult(i, s) {
        const r = ne(s)
          , h = In(i, r);
        return this.optimisticQueryResults.queryResult(h)
    }
    localQueryResultByToken(i) {
        return this.optimisticQueryResults.queryResult(i)
    }
    hasLocalQueryResultByToken(i) {
        return this.optimisticQueryResults.hasQueryResult(i)
    }
    localQueryLogs(i, s) {
        const r = ne(s)
          , h = In(i, r);
        return this.optimisticQueryResults.queryLogs(h)
    }
    queryJournal(i, s) {
        const r = ne(s)
          , h = In(i, r);
        return this.state.queryJournal(h)
    }
    connectionState() {
        const i = this.webSocketManager.connectionState();
        return {
            hasInflightRequests: this.requestManager.hasInflightRequests(),
            isWebSocketConnected: i.isConnected,
            hasEverConnected: i.hasEverConnected,
            connectionCount: i.connectionCount,
            connectionRetries: i.connectionRetries,
            timeOfOldestInflightRequest: this.requestManager.timeOfOldestInflightRequest(),
            inflightMutations: this.requestManager.inflightMutations(),
            inflightActions: this.requestManager.inflightActions()
        }
    }
    async mutation(i, s, r) {
        const h = await this.mutationInternal(i, s, r);
        if (!h.success)
            throw h.errorData !== void 0 ? $c(h, new Fn(Ll("mutation", i, h))) : new Error(Ll("mutation", i, h));
        return h.value
    }
    async mutationInternal(i, s, r, h) {
        const {mutationPromise: g} = this.enqueueMutation(i, s, r, h);
        return g
    }
    enqueueMutation(i, s, r, h) {
        const g = ne(s);
        this.tryReportLongDisconnect();
        const E = this.nextRequestId;
        if (this._nextRequestId++,
        r !== void 0) {
            const D = r.optimisticUpdate;
            if (D !== void 0) {
                const Z = et => {
                    D(et, g)instanceof Promise && this.logger.warn("Optimistic update handler returned a Promise. Optimistic updates should be synchronous.")
                }
                  , G = this.optimisticQueryResults.applyOptimisticUpdate(Z, E).map(et => {
                    const yt = this.localQueryResultByToken(et);
                    return {
                        token: et,
                        modification: {
                            kind: "Updated",
                            result: yt === void 0 ? void 0 : {
                                success: !0,
                                value: yt,
                                logLines: []
                            }
                        }
                    }
                }
                );
                this.handleTransition({
                    queries: G,
                    reflectedMutations: [],
                    timestamp: this.remoteQuerySet.timestamp()
                })
            }
        }
        const x = {
            type: "Mutation",
            requestId: E,
            udfPath: i,
            componentPath: h,
            args: [Re(g)]
        }
          , T = this.webSocketManager.sendMessage(x)
          , b = this.requestManager.request(x, T);
        return {
            requestId: E,
            mutationPromise: b
        }
    }
    async action(i, s) {
        const r = await this.actionInternal(i, s);
        if (!r.success)
            throw r.errorData !== void 0 ? $c(r, new Fn(Ll("action", i, r))) : new Error(Ll("action", i, r));
        return r.value
    }
    async actionInternal(i, s, r) {
        const h = ne(s)
          , g = this.nextRequestId;
        this._nextRequestId++,
        this.tryReportLongDisconnect();
        const E = {
            type: "Action",
            requestId: g,
            udfPath: i,
            componentPath: r,
            args: [Re(h)]
        }
          , x = this.webSocketManager.sendMessage(E);
        return this.requestManager.request(E, x)
    }
    async close() {
        return this.authenticationManager.stop(),
        this.webSocketManager.terminate()
    }
    get url() {
        return this.address
    }
    get nextRequestId() {
        return this._nextRequestId
    }
    get sessionId() {
        return this._sessionId
    }
    reportMarks() {
        if (this.debug) {
            const i = xm(this.sessionId);
            this.webSocketManager.sendMessage({
                type: "Event",
                eventType: "ClientConnect",
                event: i
            })
        }
    }
    tryReportLongDisconnect() {
        if (!this.debug)
            return;
        const i = this.connectionState().timeOfOldestInflightRequest;
        if (i === null || Date.now() - i.getTime() <= 60 * 1e3)
            return;
        const s = `${this.address}/api/debug_event`;
        fetch(s, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Convex-Client": `npm-${Wn}`
            },
            body: JSON.stringify({
                event: "LongWebsocketDisconnect"
            })
        }).then(r => {
            r.ok || this.logger.warn("Analytics request failed with response:", r.body)
        }
        ).catch(r => {
            this.logger.warn("Analytics response failed with error:", r)
        }
        )
    }
}
var Um = Object.defineProperty
  , Nm = (c, i, s) => i in c ? Um(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , $n = (c, i, s) => Nm(c, typeof i != "symbol" ? i + "" : i, s);
const oi = 560;
class Qm {
    constructor(i, s) {
        if ($n(this, "address"),
        $n(this, "auth"),
        $n(this, "adminAuth"),
        $n(this, "encodedTsPromise"),
        $n(this, "debug"),
        $n(this, "fetchOptions"),
        $n(this, "logger"),
        typeof s == "boolean")
            throw new Error("skipConvexDeploymentUrlCheck as the second argument is no longer supported. Please pass an options object, `{ skipConvexDeploymentUrlCheck: true }`.");
        (s ?? {}).skipConvexDeploymentUrlCheck !== !0 && Sd(i),
        this.logger = (s == null ? void 0 : s.logger) === !1 ? Pc({
            verbose: !1
        }) : (s == null ? void 0 : s.logger) !== !0 && (s != null && s.logger) ? s.logger : Ic({
            verbose: !1
        }),
        this.address = i,
        this.debug = !0
    }
    backendUrl() {
        return `${this.address}/api`
    }
    get url() {
        return this.address
    }
    setAuth(i) {
        this.clearAuth(),
        this.auth = i
    }
    setAdminAuth(i, s) {
        if (this.clearAuth(),
        s !== void 0) {
            const r = new TextEncoder().encode(JSON.stringify(s))
              , h = btoa(String.fromCodePoint(...r));
            this.adminAuth = `${i}:${h}`
        } else
            this.adminAuth = i
    }
    clearAuth() {
        this.auth = void 0,
        this.adminAuth = void 0
    }
    setDebug(i) {
        this.debug = i
    }
    setFetchOptions(i) {
        this.fetchOptions = i
    }
    async consistentQuery(i, ...s) {
        const r = ne(s[0])
          , h = this.getTimestamp();
        return await this.queryInner(i, r, {
            timestampPromise: h
        })
    }
    async getTimestamp() {
        return this.encodedTsPromise ? this.encodedTsPromise : this.encodedTsPromise = this.getTimestampInner()
    }
    async getTimestampInner() {
        const i = fetch
          , s = {
            "Content-Type": "application/json",
            "Convex-Client": `npm-${Wn}`
        }
          , r = await i(`${this.address}/api/query_ts`, {
            ...this.fetchOptions,
            method: "POST",
            headers: s
        });
        if (!r.ok)
            throw new Error(await r.text());
        const {ts: h} = await r.json();
        return h
    }
    async query(i, ...s) {
        const r = ne(s[0]);
        return await this.queryInner(i, r, {})
    }
    async queryInner(i, s, r) {
        const h = Vt(i)
          , g = [Re(s)]
          , E = {
            "Content-Type": "application/json",
            "Convex-Client": `npm-${Wn}`
        };
        this.adminAuth ? E.Authorization = `Convex ${this.adminAuth}` : this.auth && (E.Authorization = `Bearer ${this.auth}`);
        const x = fetch
          , T = r.timestampPromise ? await r.timestampPromise : void 0
          , b = JSON.stringify({
            path: h,
            format: "convex_encoded_json",
            args: g,
            ...T ? {
                ts: T
            } : {}
        })
          , D = T ? `${this.address}/api/query_at_ts` : `${this.address}/api/query`
          , Z = await x(D, {
            ...this.fetchOptions,
            body: b,
            method: "POST",
            headers: E
        });
        if (!Z.ok && Z.status !== oi)
            throw new Error(await Z.text());
        const z = await Z.json();
        if (this.debug)
            for (const G of z.logLines ?? [])
                xn(this.logger, "info", "query", h, G);
        switch (z.status) {
        case "success":
            return xe(z.value);
        case "error":
            throw z.errorData !== void 0 ? fi(z.errorData, new Fn(z.errorMessage)) : new Error(z.errorMessage);
        default:
            throw new Error(`Invalid response: ${JSON.stringify(z)}`)
        }
    }
    async mutation(i, ...s) {
        const r = ne(s[0])
          , h = Vt(i)
          , g = JSON.stringify({
            path: h,
            format: "convex_encoded_json",
            args: [Re(r)]
        })
          , E = {
            "Content-Type": "application/json",
            "Convex-Client": `npm-${Wn}`
        };
        this.adminAuth ? E.Authorization = `Convex ${this.adminAuth}` : this.auth && (E.Authorization = `Bearer ${this.auth}`);
        const T = await fetch(`${this.address}/api/mutation`, {
            ...this.fetchOptions,
            body: g,
            method: "POST",
            headers: E
        });
        if (!T.ok && T.status !== oi)
            throw new Error(await T.text());
        const b = await T.json();
        if (this.debug)
            for (const D of b.logLines ?? [])
                xn(this.logger, "info", "mutation", h, D);
        switch (b.status) {
        case "success":
            return xe(b.value);
        case "error":
            throw b.errorData !== void 0 ? fi(b.errorData, new Fn(b.errorMessage)) : new Error(b.errorMessage);
        default:
            throw new Error(`Invalid response: ${JSON.stringify(b)}`)
        }
    }
    async action(i, ...s) {
        const r = ne(s[0])
          , h = Vt(i)
          , g = JSON.stringify({
            path: h,
            format: "convex_encoded_json",
            args: [Re(r)]
        })
          , E = {
            "Content-Type": "application/json",
            "Convex-Client": `npm-${Wn}`
        };
        this.adminAuth ? E.Authorization = `Convex ${this.adminAuth}` : this.auth && (E.Authorization = `Bearer ${this.auth}`);
        const T = await fetch(`${this.address}/api/action`, {
            ...this.fetchOptions,
            body: g,
            method: "POST",
            headers: E
        });
        if (!T.ok && T.status !== oi)
            throw new Error(await T.text());
        const b = await T.json();
        if (this.debug)
            for (const D of b.logLines ?? [])
                xn(this.logger, "info", "action", h, D);
        switch (b.status) {
        case "success":
            return xe(b.value);
        case "error":
            throw b.errorData !== void 0 ? fi(b.errorData, new Fn(b.errorMessage)) : new Error(b.errorMessage);
        default:
            throw new Error(`Invalid response: ${JSON.stringify(b)}`)
        }
    }
    async function(i, s, ...r) {
        const h = ne(r[0])
          , g = typeof i == "string" ? i : Vt(i)
          , E = JSON.stringify({
            componentPath: s,
            path: g,
            format: "convex_encoded_json",
            args: Re(h)
        })
          , x = {
            "Content-Type": "application/json",
            "Convex-Client": `npm-${Wn}`
        };
        this.adminAuth ? x.Authorization = `Convex ${this.adminAuth}` : this.auth && (x.Authorization = `Bearer ${this.auth}`);
        const b = await fetch(`${this.address}/api/function`, {
            ...this.fetchOptions,
            body: E,
            method: "POST",
            headers: x
        });
        if (!b.ok && b.status !== oi)
            throw new Error(await b.text());
        const D = await b.json();
        if (this.debug)
            for (const Z of D.logLines ?? [])
                xn(this.logger, "info", "any", g, Z);
        switch (D.status) {
        case "success":
            return xe(D.value);
        case "error":
            throw D.errorData !== void 0 ? fi(D.errorData, new Fn(D.errorMessage)) : new Error(D.errorMessage);
        default:
            throw new Error(`Invalid response: ${JSON.stringify(D)}`)
        }
    }
}
function fi(c, i) {
    return i.data = xe(c),
    i
}
var Bm = Object.defineProperty
  , Hm = (c, i, s) => i in c ? Bm(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , qn = (c, i, s) => Hm(c, typeof i != "symbol" ? i + "" : i, s);
if (typeof qe > "u")
    throw new Error("Required dependency 'react' not found");
function xd(c, i, s) {
    function r(h) {
        return Vm(h),
        i.mutation(c, h, {
            optimisticUpdate: s
        })
    }
    return r.withOptimisticUpdate = function(g) {
        if (s !== void 0)
            throw new Error(`Already specified optimistic update for mutation ${Vt(c)}`);
        return xd(c, i, g)
    }
    ,
    r
}
class Lm {
    constructor(i, s) {
        if (qn(this, "address"),
        qn(this, "cachedSync"),
        qn(this, "listeners"),
        qn(this, "options"),
        qn(this, "closed", !1),
        qn(this, "_logger"),
        qn(this, "adminAuth"),
        qn(this, "fakeUserIdentity"),
        i === void 0)
            throw new Error("No address provided to ConvexReactClient.\nIf trying to deploy to production, make sure to follow all the instructions found at https://docs.convex.dev/production/hosting/\nIf running locally, make sure to run `convex dev` and ensure the .env.local file is populated.");
        if (typeof i != "string")
            throw new Error(`ConvexReactClient requires a URL like 'https://happy-otter-123.convex.cloud', received something of type ${typeof i} instead.`);
        if (!i.includes("://"))
            throw new Error("Provided address was not an absolute URL.");
        this.address = i,
        this.listeners = new Map,
        this._logger = (s == null ? void 0 : s.logger) === !1 ? Pc({
            verbose: (s == null ? void 0 : s.verbose) ?? !1
        }) : (s == null ? void 0 : s.logger) !== !0 && (s != null && s.logger) ? s.logger : Ic({
            verbose: (s == null ? void 0 : s.verbose) ?? !1
        }),
        this.options = {
            ...s,
            logger: this._logger
        }
    }
    get url() {
        return this.address
    }
    get sync() {
        if (this.closed)
            throw new Error("ConvexReactClient has already been closed.");
        return this.cachedSync ? this.cachedSync : (this.cachedSync = new zm(this.address,i => this.transition(i),this.options),
        this.adminAuth && this.cachedSync.setAdminAuth(this.adminAuth, this.fakeUserIdentity),
        this.cachedSync)
    }
    setAuth(i, s) {
        if (typeof i == "string")
            throw new Error("Passing a string to ConvexReactClient.setAuth is no longer supported, please upgrade to passing in an async function to handle reauthentication.");
        this.sync.setAuth(i, s ?? ( () => {}
        ))
    }
    clearAuth() {
        this.sync.clearAuth()
    }
    setAdminAuth(i, s) {
        if (this.adminAuth = i,
        this.fakeUserIdentity = s,
        this.closed)
            throw new Error("ConvexReactClient has already been closed.");
        this.cachedSync && this.sync.setAdminAuth(i, s)
    }
    watchQuery(i, ...s) {
        const [r,h] = s
          , g = Vt(i);
        return {
            onUpdate: E => {
                const {queryToken: x, unsubscribe: T} = this.sync.subscribe(g, r, h)
                  , b = this.listeners.get(x);
                return b !== void 0 ? b.add(E) : this.listeners.set(x, new Set([E])),
                () => {
                    if (this.closed)
                        return;
                    const D = this.listeners.get(x);
                    D.delete(E),
                    D.size === 0 && this.listeners.delete(x),
                    T()
                }
            }
            ,
            localQueryResult: () => {
                if (this.cachedSync)
                    return this.cachedSync.localQueryResult(g, r)
            }
            ,
            localQueryLogs: () => {
                if (this.cachedSync)
                    return this.cachedSync.localQueryLogs(g, r)
            }
            ,
            journal: () => {
                if (this.cachedSync)
                    return this.cachedSync.queryJournal(g, r)
            }
        }
    }
    mutation(i, ...s) {
        const [r,h] = s
          , g = Vt(i);
        return this.sync.mutation(g, r, h)
    }
    action(i, ...s) {
        const r = Vt(i);
        return this.sync.action(r, ...s)
    }
    query(i, ...s) {
        const r = this.watchQuery(i, ...s)
          , h = r.localQueryResult();
        return h !== void 0 ? Promise.resolve(h) : new Promise( (g, E) => {
            const x = r.onUpdate( () => {
                x();
                try {
                    g(r.localQueryResult())
                } catch (T) {
                    E(T)
                }
            }
            )
        }
        )
    }
    connectionState() {
        return this.sync.connectionState()
    }
    get logger() {
        return this._logger
    }
    async close() {
        if (this.closed = !0,
        this.listeners = new Map,
        this.cachedSync) {
            const i = this.cachedSync;
            this.cachedSync = void 0,
            await i.close()
        }
    }
    transition(i) {
        for (const s of i) {
            const r = this.listeners.get(s);
            if (r)
                for (const h of r)
                    h()
        }
    }
}
const tr = qe.createContext(void 0);
function Cd() {
    return H.useContext(tr)
}
const jm = ({client: c, children: i}) => qe.createElement(tr.Provider, {
    value: c
}, i);
function Dd(c, ...i) {
    const s = i[0] === "skip"
      , r = i[0] === "skip" ? {} : ne(i[0])
      , h = typeof c == "string" ? Md(c) : c
      , g = Vt(h)
      , E = H.useMemo( () => s ? {} : {
        query: {
            query: h,
            args: r
        }
    }, [JSON.stringify(Re(r)), g, s])
      , T = Zm(E).query;
    if (T instanceof Error)
        throw T;
    return T
}
function dd(c) {
    const i = typeof c == "string" ? Md(c) : c
      , s = H.useContext(tr);
    if (s === void 0)
        throw new Error("Could not find Convex client! `useMutation` must be used in the React component tree under `ConvexProvider`. Did you forget it? See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app");
    return H.useMemo( () => xd(i, s), [s, Vt(i)])
}
function Vm(c) {
    if (typeof c == "object" && c !== null && "bubbles"in c && "persist"in c && "isDefaultPrevented"in c)
        throw new Error("Convex function called with SyntheticEvent object. Did you use a Convex function as an event handler directly? Event handlers like onClick receive an event object as their first argument. These SyntheticEvent objects are not valid Convex values. Try wrapping the function like `const handler = () => myMutation();` and using `handler` in the event handler.")
}
var Ym = Object.defineProperty
  , Gm = (c, i, s) => i in c ? Ym(c, i, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : c[i] = s
  , Gc = (c, i, s) => Gm(c, typeof i != "symbol" ? i + "" : i, s);
class Xm {
    constructor(i) {
        Gc(this, "createWatch"),
        Gc(this, "queries"),
        Gc(this, "listeners"),
        this.createWatch = i,
        this.queries = {},
        this.listeners = new Set
    }
    setQueries(i) {
        for (const s of Object.keys(i)) {
            const {query: r, args: h} = i[s];
            if (Vt(r),
            this.queries[s] === void 0)
                this.addQuery(s, r, h);
            else {
                const g = this.queries[s];
                (Vt(r) !== Vt(g.query) || JSON.stringify(Re(h)) !== JSON.stringify(Re(g.args))) && (this.removeQuery(s),
                this.addQuery(s, r, h))
            }
        }
        for (const s of Object.keys(this.queries))
            i[s] === void 0 && this.removeQuery(s)
    }
    subscribe(i) {
        return this.listeners.add(i),
        () => {
            this.listeners.delete(i)
        }
    }
    getLocalResults(i) {
        const s = {};
        for (const r of Object.keys(i)) {
            const {query: h, args: g} = i[r];
            Vt(h);
            const E = this.createWatch(h, g);
            let x;
            try {
                x = E.localQueryResult()
            } catch (T) {
                if (T instanceof Error)
                    x = T;
                else
                    throw T
            }
            s[r] = x
        }
        return s
    }
    setCreateWatch(i) {
        this.createWatch = i;
        for (const s of Object.keys(this.queries)) {
            const {query: r, args: h, watch: g} = this.queries[s]
              , E = g.journal();
            this.removeQuery(s),
            this.addQuery(s, r, h, E)
        }
    }
    destroy() {
        for (const i of Object.keys(this.queries))
            this.removeQuery(i);
        this.listeners = new Set
    }
    addQuery(i, s, r, h) {
        if (this.queries[i] !== void 0)
            throw new Error(`Tried to add a new query with identifier ${i} when it already exists.`);
        const g = this.createWatch(s, r, h)
          , E = g.onUpdate( () => this.notifyListeners());
        this.queries[i] = {
            query: s,
            args: r,
            watch: g,
            unsubscribe: E
        }
    }
    removeQuery(i) {
        const s = this.queries[i];
        if (s === void 0)
            throw new Error(`No query found with identifier ${i}.`);
        s.unsubscribe(),
        delete this.queries[i]
    }
    notifyListeners() {
        for (const i of this.listeners)
            i()
    }
}
function km({getCurrentValue: c, subscribe: i}) {
    const [s,r] = H.useState( () => ({
        getCurrentValue: c,
        subscribe: i,
        value: c()
    }));
    let h = s.value;
    return (s.getCurrentValue !== c || s.subscribe !== i) && (h = c(),
    r({
        getCurrentValue: c,
        subscribe: i,
        value: h
    })),
    H.useEffect( () => {
        let g = !1;
        const E = () => {
            g || r(T => {
                if (T.getCurrentValue !== c || T.subscribe !== i)
                    return T;
                const b = c();
                return T.value === b ? T : {
                    ...T,
                    value: b
                }
            }
            )
        }
          , x = i(E);
        return E(),
        () => {
            g = !0,
            x()
        }
    }
    , [c, i]),
    h
}
function Zm(c) {
    const i = Cd();
    if (i === void 0)
        throw new Error("Could not find Convex client! `useQuery` must be used in the React component tree under `ConvexProvider`. Did you forget it? See https://docs.convex.dev/quick-start#set-up-convex-in-your-react-app");
    const s = H.useMemo( () => (r, h, g) => i.watchQuery(r, h, {
        journal: g
    }), [i]);
    return Km(c, s)
}
function Km(c, i) {
    const [s] = H.useState( () => new Xm(i));
    s.createWatch !== i && s.setCreateWatch(i),
    H.useEffect( () => () => s.destroy(), [s]);
    const r = H.useMemo( () => ({
        getCurrentValue: () => s.getLocalResults(c),
        subscribe: h => (s.setQueries(c),
        s.subscribe(h))
    }), [s, c]);
    return km(r)
}
const zd = H.createContext(void 0);
function Ud() {
    const c = H.useContext(zd);
    if (c === void 0)
        throw new Error("Could not find `ConvexProviderWithAuth` (or `ConvexProviderWithClerk` or `ConvexProviderWithAuth0`) as an ancestor component. This component may be missing, or you might have two instances of the `convex/react` module loaded in your project.");
    return c
}
function Jm({children: c, client: i, useAuth: s}) {
    const {isLoading: r, isAuthenticated: h, fetchAccessToken: g} = s()
      , [E,x] = H.useState(null);
    return r && E !== null && x(null),
    !r && !h && E !== !1 && x(!1),
    qe.createElement(zd.Provider, {
        value: {
            isLoading: E === null,
            isAuthenticated: h && (E ?? !1)
        }
    }, qe.createElement($m, {
        authProviderAuthenticated: h,
        fetchAccessToken: g,
        authProviderLoading: r,
        client: i,
        setIsConvexAuthenticated: x
    }), qe.createElement(jm, {
        client: i
    }, c), qe.createElement(Wm, {
        authProviderAuthenticated: h,
        fetchAccessToken: g,
        authProviderLoading: r,
        client: i,
        setIsConvexAuthenticated: x
    }))
}
function $m({authProviderAuthenticated: c, fetchAccessToken: i, authProviderLoading: s, client: r, setIsConvexAuthenticated: h}) {
    return H.useEffect( () => {
        let g = !0;
        if (c)
            return r.setAuth(i, E => {
                g && h( () => E)
            }
            ),
            () => {
                g = !1,
                h(E => E ? !1 : null)
            }
    }
    , [c, i, s, r, h]),
    null
}
function Wm({authProviderAuthenticated: c, fetchAccessToken: i, authProviderLoading: s, client: r, setIsConvexAuthenticated: h}) {
    return H.useEffect( () => {
        if (c)
            return () => {
                r.clearAuth(),
                h( () => null)
            }
    }
    , [c, i, s, r, h]),
    null
}
function Fm({children: c}) {
    const {isLoading: i, isAuthenticated: s} = Ud();
    return i || !s ? null : qe.createElement(qe.Fragment, null, c)
}
function Im({children: c}) {
    const {isLoading: i, isAuthenticated: s} = Ud();
    return i || s ? null : qe.createElement(qe.Fragment, null, c)
}
const Pm = Object.prototype.toString
  , t0 = c => Pm.call(c) === "[object Error]"
  , e0 = new Set(["network error", "Failed to fetch", "NetworkError when attempting to fetch resource.", "The Internet connection appears to be offline.", "Load failed", "Network request failed", "fetch failed", "terminated"]);
function n0(c) {
    return c && t0(c) && c.name === "TypeError" && typeof c.message == "string" ? c.message === "Load failed" ? c.stack === void 0 : e0.has(c.message) : !1
}
const Xc = [500, 2e3]
  , l0 = 100
  , Nd = H.createContext(void 0)
  , Qd = H.createContext(void 0);
function a0() {
    return H.useContext(Qd)
}
const u0 = H.createContext(null)
  , kc = "__convexAuthOAuthVerifier"
  , hi = "__convexAuthJWT"
  , di = "__convexAuthRefreshToken"
  , yd = "__convexAuthServerStateFetchTime";
function i0({client: c, serverState: i, onChange: s, shouldHandleCode: r, storage: h, storageNamespace: g, replaceURL: E, children: x}) {
    const T = H.useRef((i == null ? void 0 : i._state.token) ?? null)
      , [b,D] = H.useState(T.current === null)
      , [Z,z] = H.useState(T.current)
      , G = c.verbose ?? !1
      , et = H.useCallback(K => {
        var _;
        G && (console.debug(`${new Date().toISOString()} ${K}`),
        (_ = c.logger) == null || _.logVerbose(K))
    }
    , [G])
      , {storageSet: yt, storageGet: F, storageRemove: Zt, storageKey: Qt} = s0(h, g)
      , [St,pt] = H.useState(!1)
      , X = H.useCallback(async K => {
        const _ = T.current !== null;
        let C;
        if (K.tokens === null)
            T.current = null,
            K.shouldStore && (await Zt(hi),
            await Zt(di)),
            C = null;
        else {
            const {token: U} = K.tokens;
            if (T.current = U,
            K.shouldStore) {
                const {refreshToken: W} = K.tokens;
                await yt(hi, U),
                await yt(di, W)
            }
            C = U
        }
        _ !== (C !== null) && await (s == null ? void 0 : s()),
        z(C),
        D(!1)
    }
    , [yt, Zt]);
    H.useEffect( () => {
        const K = async _ => {
            if (St) {
                _.preventDefault();
                const C = "Are you sure you want to leave? Your changes may not be saved.";
                return _.returnValue = !0,
                C
            }
        }
        ;
        return gd("beforeunload", K),
        () => {
            vd("beforeunload", K)
        }
    }
    ),
    H.useEffect( () => {
        const K = _ => {
            (async () => {
                if (_.storageArea === h && _.key === Qt(hi)) {
                    const C = _.newValue;
                    et(`synced access token, is null: ${C === null}`),
                    await X({
                        shouldStore: !1,
                        tokens: C === null ? null : {
                            token: C
                        }
                    })
                }
            }
            )()
        }
        ;
        return gd("storage", K),
        () => vd("storage", K)
    }
    , [X]);
    const Bt = H.useCallback(async K => {
        let _, C = 0;
        for (; C < Xc.length; )
            try {
                return await c.unauthenticatedCall("auth:signIn", "code"in K ? {
                    params: {
                        code: K.code
                    },
                    verifier: K.verifier
                } : K)
            } catch (U) {
                if (_ = U,
                !n0(U))
                    break;
                const W = Xc[C] + l0 * Math.random();
                C++,
                et(`verifyCode failed with network error, retry ${C} of ${Xc.length} in ${W}ms`),
                await new Promise(y => setTimeout(y, W))
            }
        throw _
    }
    , [c])
      , wt = H.useCallback(async K => {
        const {tokens: _} = await Bt(K);
        return et(`retrieved tokens, is null: ${_ === null}`),
        await X({
            shouldStore: !0,
            tokens: _ ?? null
        }),
        _ !== null
    }
    , [c, X])
      , Tt = H.useCallback(async (K, _) => {
        const C = _ instanceof FormData ? Array.from(_.entries()).reduce( (y, [q,Q]) => (y[q] = Q,
        y), {}) : _ ?? {}
          , U = await F(kc) ?? void 0;
        await Zt(kc);
        const W = await c.authenticatedCall("auth:signIn", {
            provider: K,
            params: C,
            verifier: U
        });
        if (W.redirect !== void 0) {
            const y = new URL(W.redirect);
            return await yt(kc, W.verifier),
            navigator.product !== "ReactNative" && (window.location.href = y.toString()),
            {
                signingIn: !1,
                redirect: y
            }
        } else if (W.tokens !== void 0) {
            const {tokens: y} = W;
            return et(`signed in and got tokens, is null: ${y === null}`),
            await X({
                shouldStore: !0,
                tokens: y
            }),
            {
                signingIn: W.tokens !== null
            }
        }
        return {
            signingIn: !1
        }
    }
    , [c, X, F])
      , $t = H.useCallback(async () => {
        try {
            await c.authenticatedCall("auth:signOut")
        } catch {}
        et("signed out, erasing tokens"),
        await X({
            shouldStore: !0,
            tokens: null
        })
    }
    , [X, c])
      , je = H.useCallback(async ({forceRefreshToken: K}) => {
        if (K) {
            const _ = T.current;
            return await r0(di, async () => {
                const C = T.current;
                if (C !== _)
                    return et(`returning synced token, is null: ${C === null}`),
                    C;
                const U = await F(di) ?? null;
                return U !== null ? (pt(!0),
                await wt({
                    refreshToken: U
                }).finally( () => {
                    pt(!1)
                }
                ),
                et(`returning retrieved token, is null: ${C === null}`),
                T.current) : (pt(!1),
                et("returning null, there is no refresh token"),
                null)
            }
            )
        }
        return T.current
    }
    , [wt, $t, F])
      , Wt = H.useRef(!1);
    H.useEffect( () => {
        var C;
        if (h === void 0)
            throw new Error("`localStorage` is not available in this environment, set the `storage` prop on `ConvexAuthProvider`!");
        const K = async () => {
            const U = await F(hi) ?? null;
            et(`retrieved token from storage, is null: ${U === null}`),
            await X({
                shouldStore: !1,
                tokens: U === null ? null : {
                    token: U
                }
            })
        }
        ;
        if (i !== void 0) {
            const U = F(yd)
              , W = y => {
                if (!y || i._timeFetched > +y) {
                    const {token: q, refreshToken: Q} = i._state
                      , N = q === null || Q === null ? null : {
                        token: q,
                        refreshToken: Q
                    };
                    yt(yd, i._timeFetched.toString()),
                    X({
                        tokens: N,
                        shouldStore: !0
                    })
                } else
                    K()
            }
            ;
            U instanceof Promise ? U.then(W) : W(U);
            return
        }
        const _ = typeof ((C = window == null ? void 0 : window.location) == null ? void 0 : C.search) < "u" ? new URLSearchParams(window.location.search).get("code") : null;
        if (Wt.current || _) {
            if (_ && !Wt.current && (!r || r())) {
                Wt.current = !0;
                const U = new URL(window.location.href);
                U.searchParams.delete("code"),
                (async () => (await E(U.pathname + U.search + U.hash),
                await Tt(void 0, {
                    code: _
                }),
                Wt.current = !1))()
            }
        } else
            K()
    }
    , [c, F]);
    const Ct = H.useMemo( () => ({
        signIn: Tt,
        signOut: $t
    }), [Tt, $t])
      , Ce = Z !== null
      , Ve = H.useMemo( () => ({
        isLoading: b,
        isAuthenticated: Ce,
        fetchAccessToken: je
    }), [je, b, Ce]);
    return $.jsx(Qd.Provider, {
        value: Ve,
        children: $.jsx(Nd.Provider, {
            value: Ct,
            children: $.jsx(u0.Provider, {
                value: Z,
                children: x
            })
        })
    })
}
function s0(c, i) {
    const s = c0()
      , r = H.useMemo( () => c ?? s(), [c])
      , h = i.replace(/[^a-zA-Z0-9]/g, "")
      , g = H.useCallback(b => `${b}_${h}`, [i])
      , E = H.useCallback( (b, D) => r.setItem(g(b), D), [r, g])
      , x = H.useCallback(b => r.getItem(g(b)), [r, g])
      , T = H.useCallback(b => r.removeItem(g(b)), [r, g]);
    return {
        storageSet: E,
        storageGet: x,
        storageRemove: T,
        storageKey: g
    }
}
function c0() {
    const [c,i] = H.useState({});
    return () => ({
        getItem: s => c[s],
        setItem: (s, r) => {
            i(h => ({
                ...h,
                [s]: r
            }))
        }
        ,
        removeItem: s => {
            i(r => {
                const {[s]: h, ...g} = r;
                return g
            }
            )
        }
    })
}
async function r0(c, i) {
    var r;
    const s = (r = window == null ? void 0 : window.navigator) == null ? void 0 : r.locks;
    return s !== void 0 ? await s.request(c, i) : await o0(c, i)
}
function yi(c) {
    globalThis.__convexAuthMutexes === void 0 && (globalThis.__convexAuthMutexes = {});
    let i = globalThis.__convexAuthMutexes[c];
    return i === void 0 && (globalThis.__convexAuthMutexes[c] = {
        currentlyRunning: null,
        waiting: []
    }),
    i = globalThis.__convexAuthMutexes[c],
    i
}
function Zc(c, i) {
    globalThis.__convexAuthMutexes[c] = i
}
async function Bd(c, i) {
    const s = yi(c);
    s.currentlyRunning === null ? Zc(c, {
        currentlyRunning: i().finally( () => {
            const r = yi(c).waiting.shift();
            yi(c).currentlyRunning = null,
            Zc(c, {
                ...yi(c),
                currentlyRunning: r === void 0 ? null : Bd(c, r)
            })
        }
        ),
        waiting: []
    }) : Zc(c, {
        ...s,
        waiting: [...s.waiting, i]
    })
}
async function o0(c, i) {
    return new Promise( (r, h) => {
        Bd(c, () => i().then(E => r(E)).catch(E => h(E)))
    }
    )
}
function gd(c, i, s) {
    var r;
    (r = window.addEventListener) == null || r.call(window, c, i, s)
}
function vd(c, i, s) {
    var r;
    (r = window.removeEventListener) == null || r.call(window, c, i, s)
}
function Hd() {
    return H.useContext(Nd)
}
function f0(c) {
    const {client: i, storage: s, storageNamespace: r, replaceURL: h, shouldHandleCode: g, children: E} = c
      , x = H.useMemo( () => {
        var T;
        return {
            authenticatedCall(b, D) {
                return i.action(b, D)
            },
            unauthenticatedCall(b, D) {
                return new Qm(i.address,{
                    logger: i.logger
                }).action(b, D)
            },
            verbose: (T = i.options) == null ? void 0 : T.verbose,
            logger: i.logger
        }
    }
    , [i]);
    return $.jsx(i0, {
        client: x,
        storage: s ?? (typeof window > "u" || window == null ? void 0 : window.localStorage),
        storageNamespace: r ?? i.address,
        replaceURL: h ?? (T => {
            window.history.replaceState({}, "", T)
        }
        ),
        shouldHandleCode: g,
        children: $.jsx(Jm, {
            client: i,
            useAuth: a0,
            children: E
        })
    })
}
function Ld(c, i) {
    const s = {
        get(r, h) {
            if (typeof h == "string") {
                const g = [...i, h];
                return Ld(c, g)
            } else if (h === Od) {
                if (i.length < 1) {
                    const g = [c, ...i].join(".");
                    throw new Error(`API path is expected to be of the form \`${c}.childComponent.functionName\`. Found: \`${g}\``)
                }
                return "_reference/childComponent/" + i.join("/")
            } else
                return
        }
    };
    return new Proxy({},s)
}
const h0 = () => Ld("components", [])
  , jd = Fv;
h0();
function md(c) {
    const i = H.useRef({
        inFlight: !1,
        upNext: null
    });
    return H.useCallback( (...s) => {
        if (i.current.inFlight)
            return new Promise( (h, g) => {
                i.current.upNext = {
                    fn: c,
                    resolve: h,
                    reject: g,
                    args: s
                }
            }
            );
        i.current.inFlight = !0;
        const r = c(...s);
        return (async () => {
            try {
                await r
            } finally {}
            for (; i.current.upNext; ) {
                const h = i.current.upNext;
                i.current.upNext = null,
                await h.fn(...h.args).then(h.resolve).catch(h.reject)
            }
            i.current.inFlight = !1
        }
        )(),
        r
    }
    , [c])
}
function d0(c, i, s, r=1e4, h) {
    const g = H.useRef(!1)
      , x = Cd().url
      , [T,b] = H.useState( () => crypto.randomUUID())
      , [D,Z] = H.useState(null)
      , z = H.useRef(null)
      , [G,et] = H.useState(null)
      , yt = H.useRef(null)
      , F = H.useRef(null)
      , Zt = md(dd(c.heartbeat))
      , Qt = md(dd(c.disconnect));
    H.useEffect( () => {
        F.current && (clearInterval(F.current),
        F.current = null),
        z.current && Qt({
            sessionToken: z.current
        }),
        b(crypto.randomUUID()),
        Z(null),
        et(null)
    }
    , [i, s, Qt]),
    H.useEffect( () => {
        z.current = D,
        yt.current = G
    }
    , [D, G]),
    H.useEffect( () => {
        const pt = async () => {
            const Tt = await Zt({
                roomId: i,
                userId: s,
                sessionId: T,
                interval: r
            });
            et(Tt.roomToken),
            Z(Tt.sessionToken)
        }
        ;
        pt(),
        F.current && clearInterval(F.current),
        F.current = setInterval(pt, r);
        const X = () => {
            if (z.current) {
                const Tt = new Blob([JSON.stringify({
                    path: "presence:disconnect",
                    args: {
                        sessionToken: z.current
                    }
                })],{
                    type: "application/json"
                });
                navigator.sendBeacon(`${x}/api/mutation`, Tt)
            }
        }
        ;
        window.addEventListener("beforeunload", X);
        const Bt = async () => {
            document.hidden ? (F.current && (clearInterval(F.current),
            F.current = null),
            z.current && await Qt({
                sessionToken: z.current
            })) : (pt(),
            F.current && clearInterval(F.current),
            F.current = setInterval(pt, r))
        }
          , wt = () => {
            Bt().catch(console.error)
        }
        ;
        return document.addEventListener("visibilitychange", wt),
        () => {
            F.current && clearInterval(F.current),
            document.removeEventListener("visibilitychange", wt),
            window.removeEventListener("beforeunload", X),
            g.current && z.current && Qt({
                sessionToken: z.current
            })
        }
    }
    , [Zt, Qt, i, s, x, r, T]),
    H.useEffect( () => {
        g.current = !0
    }
    , []);
    const St = Dd(c.list, G ? {
        roomToken: G
    } : "skip");
    return H.useMemo( () => St == null ? void 0 : St.slice().sort( (pt, X) => pt.userId === s ? -1 : X.userId === s ? 1 : 0), [St, s])
}
function y0({presenceState: c}) {
    const i = c.slice(0, 5)
      , s = c.slice(5);
    return $.jsx("div", {
        className: "container",
        children: $.jsxs("div", {
            className: "avatars",
            children: [i.map( (r, h) => $.jsx(g0, {
                presence: r,
                index: h,
                total: i.length
            }, r.userId)), s.length > 0 && $.jsxs("div", {
                className: "more-container",
                children: [$.jsxs("div", {
                    className: "avatar more",
                    tabIndex: 0,
                    children: ["+", s.length]
                }), $.jsx(v0, {
                    users: s
                })]
            })]
        })
    })
}
function Vd(c) {
    const i = Date.now()
      , s = Math.floor((i - c) / 1e3);
    if (s < 60)
        return "Last seen just now";
    if (s < 3600)
        return `Last seen ${Math.floor(s / 60)} min ago`;
    if (s < 86400) {
        const h = Math.floor(s / 3600);
        return `Last seen ${h} hour${h === 1 ? "" : "s"} ago`
    }
    const r = Math.floor(s / 86400);
    return `Last seen ${r} day${r === 1 ? "" : "s"} ago`
}
function g0({presence: c, index: i, total: s}) {
    return $.jsxs("div", {
        className: `avatar${c.online ? " online" : " offline"}`,
        tabIndex: 0,
        style: {
            "--z": s - i
        },
        children: [$.jsx("span", {
            role: "img",
            "aria-label": "user",
            children: c.image ? $.jsx("img", {
                src: c.image,
                alt: "user"
            }) : "😊"
        }), $.jsxs("span", {
            className: "tooltip",
            children: [$.jsx("div", {
                className: "tooltip-user",
                children: c.name || c.userId
            }), $.jsx("div", {
                className: "tooltip-status",
                children: c.online ? "Online now" : Vd(c.lastDisconnected)
            })]
        })]
    })
}
function v0({users: c}) {
    return $.jsx("div", {
        className: "dropdown",
        children: c.slice(0, 10).map(i => $.jsxs("div", {
            className: "dropdown-row",
            children: [$.jsx("div", {
                className: `dropdown-emoji${i.online ? "" : " offline"}`,
                children: $.jsx("span", {
                    role: "img",
                    "aria-label": "user",
                    children: i.image ? $.jsx("img", {
                        src: i.image,
                        alt: "user"
                    }) : "😊"
                })
            }), $.jsxs("div", {
                className: "dropdown-info",
                children: [$.jsx("div", {
                    className: "dropdown-user",
                    children: i.name || i.userId
                }), $.jsx("div", {
                    className: "dropdown-status",
                    children: i.online ? "Online now" : Vd(i.lastDisconnected)
                })]
            })]
        }, i.userId))
    })
}
function m0() {
    const {signIn: c} = Hd();
    return $.jsx("button", {
        onClick: () => void c("github"),
        children: "Sign in with GitHub"
    })
}
function S0() {
    const {signOut: c} = Hd();
    return $.jsx("button", {
        onClick: () => void c(),
        children: "Sign out"
    })
}
function b0() {
    return $.jsxs("main", {
        children: [$.jsx("h1", {
            children: "Convex Presence with Auth"
        }), $.jsxs(Im, {
            children: [$.jsx("p", {
                children: "Sign in to see the members in the room."
            }), $.jsx(m0, {})]
        }), $.jsxs(Fm, {
            children: [$.jsx(S0, {}), $.jsx("div", {
                style: {
                    padding: "20px"
                },
                children: $.jsx(p0, {})
            })]
        })]
    })
}
function p0() {
    const c = Dd(jd.presence.getUserId);
    return c === void 0 ? $.jsx("div", {
        children: "Loading..."
    }) : c === null ? $.jsx("div", {
        children: "Authentication required"
    }) : $.jsx(T0, {
        userId: c
    })
}
function T0({userId: c}) {
    const i = d0(jd.presence, "my-chat-room", c);
    return $.jsx(y0, {
        presenceState: i ?? []
    })
}
const A0 = "https://capable-marmot-48.convex.cloud"
  , E0 = new Lm(A0);
pv.createRoot(document.getElementById("root")).render($.jsx(H.StrictMode, {
    children: $.jsx(f0, {
        client: E0,
        children: $.jsx(b0, {})
    })
}));
