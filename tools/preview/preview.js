(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/react/cjs/react.production.min.js
  var require_react_production_min = __commonJS({
    "node_modules/react/cjs/react.production.min.js"(exports) {
      "use strict";
      var l = Symbol.for("react.element");
      var n = Symbol.for("react.portal");
      var p = Symbol.for("react.fragment");
      var q = Symbol.for("react.strict_mode");
      var r = Symbol.for("react.profiler");
      var t3 = Symbol.for("react.provider");
      var u = Symbol.for("react.context");
      var v = Symbol.for("react.forward_ref");
      var w = Symbol.for("react.suspense");
      var x = Symbol.for("react.memo");
      var y = Symbol.for("react.lazy");
      var z = Symbol.iterator;
      function A(a) {
        if (null === a || "object" !== typeof a) return null;
        a = z && a[z] || a["@@iterator"];
        return "function" === typeof a ? a : null;
      }
      var B = { isMounted: function() {
        return false;
      }, enqueueForceUpdate: function() {
      }, enqueueReplaceState: function() {
      }, enqueueSetState: function() {
      } };
      var C = Object.assign;
      var D = {};
      function E(a, b, e) {
        this.props = a;
        this.context = b;
        this.refs = D;
        this.updater = e || B;
      }
      E.prototype.isReactComponent = {};
      E.prototype.setState = function(a, b) {
        if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
        this.updater.enqueueSetState(this, a, b, "setState");
      };
      E.prototype.forceUpdate = function(a) {
        this.updater.enqueueForceUpdate(this, a, "forceUpdate");
      };
      function F() {
      }
      F.prototype = E.prototype;
      function G(a, b, e) {
        this.props = a;
        this.context = b;
        this.refs = D;
        this.updater = e || B;
      }
      var H = G.prototype = new F();
      H.constructor = G;
      C(H, E.prototype);
      H.isPureReactComponent = true;
      var I = Array.isArray;
      var J = Object.prototype.hasOwnProperty;
      var K = { current: null };
      var L = { key: true, ref: true, __self: true, __source: true };
      function M(a, b, e) {
        var d, c = {}, k = null, h = null;
        if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
        var g = arguments.length - 2;
        if (1 === g) c.children = e;
        else if (1 < g) {
          for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
          c.children = f;
        }
        if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
        return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
      }
      function N(a, b) {
        return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
      }
      function O(a) {
        return "object" === typeof a && null !== a && a.$$typeof === l;
      }
      function escape2(a) {
        var b = { "=": "=0", ":": "=2" };
        return "$" + a.replace(/[=:]/g, function(a2) {
          return b[a2];
        });
      }
      var P = /\/+/g;
      function Q(a, b) {
        return "object" === typeof a && null !== a && null != a.key ? escape2("" + a.key) : b.toString(36);
      }
      function R(a, b, e, d, c) {
        var k = typeof a;
        if ("undefined" === k || "boolean" === k) a = null;
        var h = false;
        if (null === a) h = true;
        else switch (k) {
          case "string":
          case "number":
            h = true;
            break;
          case "object":
            switch (a.$$typeof) {
              case l:
              case n:
                h = true;
            }
        }
        if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
          return a2;
        })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
        h = 0;
        d = "" === d ? "." : d + ":";
        if (I(a)) for (var g = 0; g < a.length; g++) {
          k = a[g];
          var f = d + Q(k, g);
          h += R(k, b, e, f, c);
        }
        else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
        else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
        return h;
      }
      function S(a, b, e) {
        if (null == a) return a;
        var d = [], c = 0;
        R(a, d, "", "", function(a2) {
          return b.call(e, a2, c++);
        });
        return d;
      }
      function T(a) {
        if (-1 === a._status) {
          var b = a._result;
          b = b();
          b.then(function(b2) {
            if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
          }, function(b2) {
            if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
          });
          -1 === a._status && (a._status = 0, a._result = b);
        }
        if (1 === a._status) return a._result.default;
        throw a._result;
      }
      var U = { current: null };
      var V = { transition: null };
      var W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
      function X() {
        throw Error("act(...) is not supported in production builds of React.");
      }
      exports.Children = { map: S, forEach: function(a, b, e) {
        S(a, function() {
          b.apply(this, arguments);
        }, e);
      }, count: function(a) {
        var b = 0;
        S(a, function() {
          b++;
        });
        return b;
      }, toArray: function(a) {
        return S(a, function(a2) {
          return a2;
        }) || [];
      }, only: function(a) {
        if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
        return a;
      } };
      exports.Component = E;
      exports.Fragment = p;
      exports.Profiler = r;
      exports.PureComponent = G;
      exports.StrictMode = q;
      exports.Suspense = w;
      exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
      exports.act = X;
      exports.cloneElement = function(a, b, e) {
        if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
        var d = C({}, a.props), c = a.key, k = a.ref, h = a._owner;
        if (null != b) {
          void 0 !== b.ref && (k = b.ref, h = K.current);
          void 0 !== b.key && (c = "" + b.key);
          if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
          for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
        }
        var f = arguments.length - 2;
        if (1 === f) d.children = e;
        else if (1 < f) {
          g = Array(f);
          for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
          d.children = g;
        }
        return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
      };
      exports.createContext = function(a) {
        a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
        a.Provider = { $$typeof: t3, _context: a };
        return a.Consumer = a;
      };
      exports.createElement = M;
      exports.createFactory = function(a) {
        var b = M.bind(null, a);
        b.type = a;
        return b;
      };
      exports.createRef = function() {
        return { current: null };
      };
      exports.forwardRef = function(a) {
        return { $$typeof: v, render: a };
      };
      exports.isValidElement = O;
      exports.lazy = function(a) {
        return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
      };
      exports.memo = function(a, b) {
        return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
      };
      exports.startTransition = function(a) {
        var b = V.transition;
        V.transition = {};
        try {
          a();
        } finally {
          V.transition = b;
        }
      };
      exports.unstable_act = X;
      exports.useCallback = function(a, b) {
        return U.current.useCallback(a, b);
      };
      exports.useContext = function(a) {
        return U.current.useContext(a);
      };
      exports.useDebugValue = function() {
      };
      exports.useDeferredValue = function(a) {
        return U.current.useDeferredValue(a);
      };
      exports.useEffect = function(a, b) {
        return U.current.useEffect(a, b);
      };
      exports.useId = function() {
        return U.current.useId();
      };
      exports.useImperativeHandle = function(a, b, e) {
        return U.current.useImperativeHandle(a, b, e);
      };
      exports.useInsertionEffect = function(a, b) {
        return U.current.useInsertionEffect(a, b);
      };
      exports.useLayoutEffect = function(a, b) {
        return U.current.useLayoutEffect(a, b);
      };
      exports.useMemo = function(a, b) {
        return U.current.useMemo(a, b);
      };
      exports.useReducer = function(a, b, e) {
        return U.current.useReducer(a, b, e);
      };
      exports.useRef = function(a) {
        return U.current.useRef(a);
      };
      exports.useState = function(a) {
        return U.current.useState(a);
      };
      exports.useSyncExternalStore = function(a, b, e) {
        return U.current.useSyncExternalStore(a, b, e);
      };
      exports.useTransition = function() {
        return U.current.useTransition();
      };
      exports.version = "18.3.1";
    }
  });

  // node_modules/react/index.js
  var require_react = __commonJS({
    "node_modules/react/index.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_react_production_min();
      } else {
        module.exports = null;
      }
    }
  });

  // node_modules/scheduler/cjs/scheduler.production.min.js
  var require_scheduler_production_min = __commonJS({
    "node_modules/scheduler/cjs/scheduler.production.min.js"(exports) {
      "use strict";
      function f(a, b) {
        var c = a.length;
        a.push(b);
        a: for (; 0 < c; ) {
          var d = c - 1 >>> 1, e = a[d];
          if (0 < g(e, b)) a[d] = b, a[c] = e, c = d;
          else break a;
        }
      }
      function h(a) {
        return 0 === a.length ? null : a[0];
      }
      function k(a) {
        if (0 === a.length) return null;
        var b = a[0], c = a.pop();
        if (c !== b) {
          a[0] = c;
          a: for (var d = 0, e = a.length, w = e >>> 1; d < w; ) {
            var m = 2 * (d + 1) - 1, C = a[m], n = m + 1, x = a[n];
            if (0 > g(C, c)) n < e && 0 > g(x, C) ? (a[d] = x, a[n] = c, d = n) : (a[d] = C, a[m] = c, d = m);
            else if (n < e && 0 > g(x, c)) a[d] = x, a[n] = c, d = n;
            else break a;
          }
        }
        return b;
      }
      function g(a, b) {
        var c = a.sortIndex - b.sortIndex;
        return 0 !== c ? c : a.id - b.id;
      }
      if ("object" === typeof performance && "function" === typeof performance.now) {
        l = performance;
        exports.unstable_now = function() {
          return l.now();
        };
      } else {
        p = Date, q = p.now();
        exports.unstable_now = function() {
          return p.now() - q;
        };
      }
      var l;
      var p;
      var q;
      var r = [];
      var t3 = [];
      var u = 1;
      var v = null;
      var y = 3;
      var z = false;
      var A = false;
      var B = false;
      var D = "function" === typeof setTimeout ? setTimeout : null;
      var E = "function" === typeof clearTimeout ? clearTimeout : null;
      var F = "undefined" !== typeof setImmediate ? setImmediate : null;
      "undefined" !== typeof navigator && void 0 !== navigator.scheduling && void 0 !== navigator.scheduling.isInputPending && navigator.scheduling.isInputPending.bind(navigator.scheduling);
      function G(a) {
        for (var b = h(t3); null !== b; ) {
          if (null === b.callback) k(t3);
          else if (b.startTime <= a) k(t3), b.sortIndex = b.expirationTime, f(r, b);
          else break;
          b = h(t3);
        }
      }
      function H(a) {
        B = false;
        G(a);
        if (!A) if (null !== h(r)) A = true, I(J);
        else {
          var b = h(t3);
          null !== b && K(H, b.startTime - a);
        }
      }
      function J(a, b) {
        A = false;
        B && (B = false, E(L), L = -1);
        z = true;
        var c = y;
        try {
          G(b);
          for (v = h(r); null !== v && (!(v.expirationTime > b) || a && !M()); ) {
            var d = v.callback;
            if ("function" === typeof d) {
              v.callback = null;
              y = v.priorityLevel;
              var e = d(v.expirationTime <= b);
              b = exports.unstable_now();
              "function" === typeof e ? v.callback = e : v === h(r) && k(r);
              G(b);
            } else k(r);
            v = h(r);
          }
          if (null !== v) var w = true;
          else {
            var m = h(t3);
            null !== m && K(H, m.startTime - b);
            w = false;
          }
          return w;
        } finally {
          v = null, y = c, z = false;
        }
      }
      var N = false;
      var O = null;
      var L = -1;
      var P = 5;
      var Q = -1;
      function M() {
        return exports.unstable_now() - Q < P ? false : true;
      }
      function R() {
        if (null !== O) {
          var a = exports.unstable_now();
          Q = a;
          var b = true;
          try {
            b = O(true, a);
          } finally {
            b ? S() : (N = false, O = null);
          }
        } else N = false;
      }
      var S;
      if ("function" === typeof F) S = function() {
        F(R);
      };
      else if ("undefined" !== typeof MessageChannel) {
        T = new MessageChannel(), U = T.port2;
        T.port1.onmessage = R;
        S = function() {
          U.postMessage(null);
        };
      } else S = function() {
        D(R, 0);
      };
      var T;
      var U;
      function I(a) {
        O = a;
        N || (N = true, S());
      }
      function K(a, b) {
        L = D(function() {
          a(exports.unstable_now());
        }, b);
      }
      exports.unstable_IdlePriority = 5;
      exports.unstable_ImmediatePriority = 1;
      exports.unstable_LowPriority = 4;
      exports.unstable_NormalPriority = 3;
      exports.unstable_Profiling = null;
      exports.unstable_UserBlockingPriority = 2;
      exports.unstable_cancelCallback = function(a) {
        a.callback = null;
      };
      exports.unstable_continueExecution = function() {
        A || z || (A = true, I(J));
      };
      exports.unstable_forceFrameRate = function(a) {
        0 > a || 125 < a ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : P = 0 < a ? Math.floor(1e3 / a) : 5;
      };
      exports.unstable_getCurrentPriorityLevel = function() {
        return y;
      };
      exports.unstable_getFirstCallbackNode = function() {
        return h(r);
      };
      exports.unstable_next = function(a) {
        switch (y) {
          case 1:
          case 2:
          case 3:
            var b = 3;
            break;
          default:
            b = y;
        }
        var c = y;
        y = b;
        try {
          return a();
        } finally {
          y = c;
        }
      };
      exports.unstable_pauseExecution = function() {
      };
      exports.unstable_requestPaint = function() {
      };
      exports.unstable_runWithPriority = function(a, b) {
        switch (a) {
          case 1:
          case 2:
          case 3:
          case 4:
          case 5:
            break;
          default:
            a = 3;
        }
        var c = y;
        y = a;
        try {
          return b();
        } finally {
          y = c;
        }
      };
      exports.unstable_scheduleCallback = function(a, b, c) {
        var d = exports.unstable_now();
        "object" === typeof c && null !== c ? (c = c.delay, c = "number" === typeof c && 0 < c ? d + c : d) : c = d;
        switch (a) {
          case 1:
            var e = -1;
            break;
          case 2:
            e = 250;
            break;
          case 5:
            e = 1073741823;
            break;
          case 4:
            e = 1e4;
            break;
          default:
            e = 5e3;
        }
        e = c + e;
        a = { id: u++, callback: b, priorityLevel: a, startTime: c, expirationTime: e, sortIndex: -1 };
        c > d ? (a.sortIndex = c, f(t3, a), null === h(r) && a === h(t3) && (B ? (E(L), L = -1) : B = true, K(H, c - d))) : (a.sortIndex = e, f(r, a), A || z || (A = true, I(J)));
        return a;
      };
      exports.unstable_shouldYield = M;
      exports.unstable_wrapCallback = function(a) {
        var b = y;
        return function() {
          var c = y;
          y = b;
          try {
            return a.apply(this, arguments);
          } finally {
            y = c;
          }
        };
      };
    }
  });

  // node_modules/scheduler/index.js
  var require_scheduler = __commonJS({
    "node_modules/scheduler/index.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_scheduler_production_min();
      } else {
        module.exports = null;
      }
    }
  });

  // node_modules/react-dom/cjs/react-dom.production.min.js
  var require_react_dom_production_min = __commonJS({
    "node_modules/react-dom/cjs/react-dom.production.min.js"(exports) {
      "use strict";
      var aa = require_react();
      var ca = require_scheduler();
      function p(a) {
        for (var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1; c < arguments.length; c++) b += "&args[]=" + encodeURIComponent(arguments[c]);
        return "Minified React error #" + a + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
      }
      var da = /* @__PURE__ */ new Set();
      var ea = {};
      function fa(a, b) {
        ha(a, b);
        ha(a + "Capture", b);
      }
      function ha(a, b) {
        ea[a] = b;
        for (a = 0; a < b.length; a++) da.add(b[a]);
      }
      var ia = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement);
      var ja = Object.prototype.hasOwnProperty;
      var ka = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/;
      var la = {};
      var ma = {};
      function oa(a) {
        if (ja.call(ma, a)) return true;
        if (ja.call(la, a)) return false;
        if (ka.test(a)) return ma[a] = true;
        la[a] = true;
        return false;
      }
      function pa(a, b, c, d) {
        if (null !== c && 0 === c.type) return false;
        switch (typeof b) {
          case "function":
          case "symbol":
            return true;
          case "boolean":
            if (d) return false;
            if (null !== c) return !c.acceptsBooleans;
            a = a.toLowerCase().slice(0, 5);
            return "data-" !== a && "aria-" !== a;
          default:
            return false;
        }
      }
      function qa(a, b, c, d) {
        if (null === b || "undefined" === typeof b || pa(a, b, c, d)) return true;
        if (d) return false;
        if (null !== c) switch (c.type) {
          case 3:
            return !b;
          case 4:
            return false === b;
          case 5:
            return isNaN(b);
          case 6:
            return isNaN(b) || 1 > b;
        }
        return false;
      }
      function v(a, b, c, d, e, f, g) {
        this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
        this.attributeName = d;
        this.attributeNamespace = e;
        this.mustUseProperty = c;
        this.propertyName = a;
        this.type = b;
        this.sanitizeURL = f;
        this.removeEmptyString = g;
      }
      var z = {};
      "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(a) {
        z[a] = new v(a, 0, false, a, null, false, false);
      });
      [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(a) {
        var b = a[0];
        z[b] = new v(b, 1, false, a[1], null, false, false);
      });
      ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(a) {
        z[a] = new v(a, 2, false, a.toLowerCase(), null, false, false);
      });
      ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(a) {
        z[a] = new v(a, 2, false, a, null, false, false);
      });
      "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(a) {
        z[a] = new v(a, 3, false, a.toLowerCase(), null, false, false);
      });
      ["checked", "multiple", "muted", "selected"].forEach(function(a) {
        z[a] = new v(a, 3, true, a, null, false, false);
      });
      ["capture", "download"].forEach(function(a) {
        z[a] = new v(a, 4, false, a, null, false, false);
      });
      ["cols", "rows", "size", "span"].forEach(function(a) {
        z[a] = new v(a, 6, false, a, null, false, false);
      });
      ["rowSpan", "start"].forEach(function(a) {
        z[a] = new v(a, 5, false, a.toLowerCase(), null, false, false);
      });
      var ra = /[\-:]([a-z])/g;
      function sa(a) {
        return a[1].toUpperCase();
      }
      "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(a) {
        var b = a.replace(
          ra,
          sa
        );
        z[b] = new v(b, 1, false, a, null, false, false);
      });
      "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(a) {
        var b = a.replace(ra, sa);
        z[b] = new v(b, 1, false, a, "http://www.w3.org/1999/xlink", false, false);
      });
      ["xml:base", "xml:lang", "xml:space"].forEach(function(a) {
        var b = a.replace(ra, sa);
        z[b] = new v(b, 1, false, a, "http://www.w3.org/XML/1998/namespace", false, false);
      });
      ["tabIndex", "crossOrigin"].forEach(function(a) {
        z[a] = new v(a, 1, false, a.toLowerCase(), null, false, false);
      });
      z.xlinkHref = new v("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
      ["src", "href", "action", "formAction"].forEach(function(a) {
        z[a] = new v(a, 1, false, a.toLowerCase(), null, true, true);
      });
      function ta(a, b, c, d) {
        var e = z.hasOwnProperty(b) ? z[b] : null;
        if (null !== e ? 0 !== e.type : d || !(2 < b.length) || "o" !== b[0] && "O" !== b[0] || "n" !== b[1] && "N" !== b[1]) qa(b, c, e, d) && (c = null), d || null === e ? oa(b) && (null === c ? a.removeAttribute(b) : a.setAttribute(b, "" + c)) : e.mustUseProperty ? a[e.propertyName] = null === c ? 3 === e.type ? false : "" : c : (b = e.attributeName, d = e.attributeNamespace, null === c ? a.removeAttribute(b) : (e = e.type, c = 3 === e || 4 === e && true === c ? "" : "" + c, d ? a.setAttributeNS(d, b, c) : a.setAttribute(b, c)));
      }
      var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      var va = Symbol.for("react.element");
      var wa = Symbol.for("react.portal");
      var ya = Symbol.for("react.fragment");
      var za = Symbol.for("react.strict_mode");
      var Aa = Symbol.for("react.profiler");
      var Ba = Symbol.for("react.provider");
      var Ca = Symbol.for("react.context");
      var Da = Symbol.for("react.forward_ref");
      var Ea = Symbol.for("react.suspense");
      var Fa = Symbol.for("react.suspense_list");
      var Ga = Symbol.for("react.memo");
      var Ha = Symbol.for("react.lazy");
      Symbol.for("react.scope");
      Symbol.for("react.debug_trace_mode");
      var Ia = Symbol.for("react.offscreen");
      Symbol.for("react.legacy_hidden");
      Symbol.for("react.cache");
      Symbol.for("react.tracing_marker");
      var Ja = Symbol.iterator;
      function Ka(a) {
        if (null === a || "object" !== typeof a) return null;
        a = Ja && a[Ja] || a["@@iterator"];
        return "function" === typeof a ? a : null;
      }
      var A = Object.assign;
      var La;
      function Ma(a) {
        if (void 0 === La) try {
          throw Error();
        } catch (c) {
          var b = c.stack.trim().match(/\n( *(at )?)/);
          La = b && b[1] || "";
        }
        return "\n" + La + a;
      }
      var Na = false;
      function Oa(a, b) {
        if (!a || Na) return "";
        Na = true;
        var c = Error.prepareStackTrace;
        Error.prepareStackTrace = void 0;
        try {
          if (b) if (b = function() {
            throw Error();
          }, Object.defineProperty(b.prototype, "props", { set: function() {
            throw Error();
          } }), "object" === typeof Reflect && Reflect.construct) {
            try {
              Reflect.construct(b, []);
            } catch (l) {
              var d = l;
            }
            Reflect.construct(a, [], b);
          } else {
            try {
              b.call();
            } catch (l) {
              d = l;
            }
            a.call(b.prototype);
          }
          else {
            try {
              throw Error();
            } catch (l) {
              d = l;
            }
            a();
          }
        } catch (l) {
          if (l && d && "string" === typeof l.stack) {
            for (var e = l.stack.split("\n"), f = d.stack.split("\n"), g = e.length - 1, h = f.length - 1; 1 <= g && 0 <= h && e[g] !== f[h]; ) h--;
            for (; 1 <= g && 0 <= h; g--, h--) if (e[g] !== f[h]) {
              if (1 !== g || 1 !== h) {
                do
                  if (g--, h--, 0 > h || e[g] !== f[h]) {
                    var k = "\n" + e[g].replace(" at new ", " at ");
                    a.displayName && k.includes("<anonymous>") && (k = k.replace("<anonymous>", a.displayName));
                    return k;
                  }
                while (1 <= g && 0 <= h);
              }
              break;
            }
          }
        } finally {
          Na = false, Error.prepareStackTrace = c;
        }
        return (a = a ? a.displayName || a.name : "") ? Ma(a) : "";
      }
      function Pa(a) {
        switch (a.tag) {
          case 5:
            return Ma(a.type);
          case 16:
            return Ma("Lazy");
          case 13:
            return Ma("Suspense");
          case 19:
            return Ma("SuspenseList");
          case 0:
          case 2:
          case 15:
            return a = Oa(a.type, false), a;
          case 11:
            return a = Oa(a.type.render, false), a;
          case 1:
            return a = Oa(a.type, true), a;
          default:
            return "";
        }
      }
      function Qa(a) {
        if (null == a) return null;
        if ("function" === typeof a) return a.displayName || a.name || null;
        if ("string" === typeof a) return a;
        switch (a) {
          case ya:
            return "Fragment";
          case wa:
            return "Portal";
          case Aa:
            return "Profiler";
          case za:
            return "StrictMode";
          case Ea:
            return "Suspense";
          case Fa:
            return "SuspenseList";
        }
        if ("object" === typeof a) switch (a.$$typeof) {
          case Ca:
            return (a.displayName || "Context") + ".Consumer";
          case Ba:
            return (a._context.displayName || "Context") + ".Provider";
          case Da:
            var b = a.render;
            a = a.displayName;
            a || (a = b.displayName || b.name || "", a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
            return a;
          case Ga:
            return b = a.displayName || null, null !== b ? b : Qa(a.type) || "Memo";
          case Ha:
            b = a._payload;
            a = a._init;
            try {
              return Qa(a(b));
            } catch (c) {
            }
        }
        return null;
      }
      function Ra(a) {
        var b = a.type;
        switch (a.tag) {
          case 24:
            return "Cache";
          case 9:
            return (b.displayName || "Context") + ".Consumer";
          case 10:
            return (b._context.displayName || "Context") + ".Provider";
          case 18:
            return "DehydratedFragment";
          case 11:
            return a = b.render, a = a.displayName || a.name || "", b.displayName || ("" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
          case 7:
            return "Fragment";
          case 5:
            return b;
          case 4:
            return "Portal";
          case 3:
            return "Root";
          case 6:
            return "Text";
          case 16:
            return Qa(b);
          case 8:
            return b === za ? "StrictMode" : "Mode";
          case 22:
            return "Offscreen";
          case 12:
            return "Profiler";
          case 21:
            return "Scope";
          case 13:
            return "Suspense";
          case 19:
            return "SuspenseList";
          case 25:
            return "TracingMarker";
          case 1:
          case 0:
          case 17:
          case 2:
          case 14:
          case 15:
            if ("function" === typeof b) return b.displayName || b.name || null;
            if ("string" === typeof b) return b;
        }
        return null;
      }
      function Sa(a) {
        switch (typeof a) {
          case "boolean":
          case "number":
          case "string":
          case "undefined":
            return a;
          case "object":
            return a;
          default:
            return "";
        }
      }
      function Ta(a) {
        var b = a.type;
        return (a = a.nodeName) && "input" === a.toLowerCase() && ("checkbox" === b || "radio" === b);
      }
      function Ua(a) {
        var b = Ta(a) ? "checked" : "value", c = Object.getOwnPropertyDescriptor(a.constructor.prototype, b), d = "" + a[b];
        if (!a.hasOwnProperty(b) && "undefined" !== typeof c && "function" === typeof c.get && "function" === typeof c.set) {
          var e = c.get, f = c.set;
          Object.defineProperty(a, b, { configurable: true, get: function() {
            return e.call(this);
          }, set: function(a2) {
            d = "" + a2;
            f.call(this, a2);
          } });
          Object.defineProperty(a, b, { enumerable: c.enumerable });
          return { getValue: function() {
            return d;
          }, setValue: function(a2) {
            d = "" + a2;
          }, stopTracking: function() {
            a._valueTracker = null;
            delete a[b];
          } };
        }
      }
      function Va(a) {
        a._valueTracker || (a._valueTracker = Ua(a));
      }
      function Wa(a) {
        if (!a) return false;
        var b = a._valueTracker;
        if (!b) return true;
        var c = b.getValue();
        var d = "";
        a && (d = Ta(a) ? a.checked ? "true" : "false" : a.value);
        a = d;
        return a !== c ? (b.setValue(a), true) : false;
      }
      function Xa(a) {
        a = a || ("undefined" !== typeof document ? document : void 0);
        if ("undefined" === typeof a) return null;
        try {
          return a.activeElement || a.body;
        } catch (b) {
          return a.body;
        }
      }
      function Ya(a, b) {
        var c = b.checked;
        return A({}, b, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: null != c ? c : a._wrapperState.initialChecked });
      }
      function Za(a, b) {
        var c = null == b.defaultValue ? "" : b.defaultValue, d = null != b.checked ? b.checked : b.defaultChecked;
        c = Sa(null != b.value ? b.value : c);
        a._wrapperState = { initialChecked: d, initialValue: c, controlled: "checkbox" === b.type || "radio" === b.type ? null != b.checked : null != b.value };
      }
      function ab(a, b) {
        b = b.checked;
        null != b && ta(a, "checked", b, false);
      }
      function bb(a, b) {
        ab(a, b);
        var c = Sa(b.value), d = b.type;
        if (null != c) if ("number" === d) {
          if (0 === c && "" === a.value || a.value != c) a.value = "" + c;
        } else a.value !== "" + c && (a.value = "" + c);
        else if ("submit" === d || "reset" === d) {
          a.removeAttribute("value");
          return;
        }
        b.hasOwnProperty("value") ? cb(a, b.type, c) : b.hasOwnProperty("defaultValue") && cb(a, b.type, Sa(b.defaultValue));
        null == b.checked && null != b.defaultChecked && (a.defaultChecked = !!b.defaultChecked);
      }
      function db(a, b, c) {
        if (b.hasOwnProperty("value") || b.hasOwnProperty("defaultValue")) {
          var d = b.type;
          if (!("submit" !== d && "reset" !== d || void 0 !== b.value && null !== b.value)) return;
          b = "" + a._wrapperState.initialValue;
          c || b === a.value || (a.value = b);
          a.defaultValue = b;
        }
        c = a.name;
        "" !== c && (a.name = "");
        a.defaultChecked = !!a._wrapperState.initialChecked;
        "" !== c && (a.name = c);
      }
      function cb(a, b, c) {
        if ("number" !== b || Xa(a.ownerDocument) !== a) null == c ? a.defaultValue = "" + a._wrapperState.initialValue : a.defaultValue !== "" + c && (a.defaultValue = "" + c);
      }
      var eb = Array.isArray;
      function fb(a, b, c, d) {
        a = a.options;
        if (b) {
          b = {};
          for (var e = 0; e < c.length; e++) b["$" + c[e]] = true;
          for (c = 0; c < a.length; c++) e = b.hasOwnProperty("$" + a[c].value), a[c].selected !== e && (a[c].selected = e), e && d && (a[c].defaultSelected = true);
        } else {
          c = "" + Sa(c);
          b = null;
          for (e = 0; e < a.length; e++) {
            if (a[e].value === c) {
              a[e].selected = true;
              d && (a[e].defaultSelected = true);
              return;
            }
            null !== b || a[e].disabled || (b = a[e]);
          }
          null !== b && (b.selected = true);
        }
      }
      function gb(a, b) {
        if (null != b.dangerouslySetInnerHTML) throw Error(p(91));
        return A({}, b, { value: void 0, defaultValue: void 0, children: "" + a._wrapperState.initialValue });
      }
      function hb(a, b) {
        var c = b.value;
        if (null == c) {
          c = b.children;
          b = b.defaultValue;
          if (null != c) {
            if (null != b) throw Error(p(92));
            if (eb(c)) {
              if (1 < c.length) throw Error(p(93));
              c = c[0];
            }
            b = c;
          }
          null == b && (b = "");
          c = b;
        }
        a._wrapperState = { initialValue: Sa(c) };
      }
      function ib(a, b) {
        var c = Sa(b.value), d = Sa(b.defaultValue);
        null != c && (c = "" + c, c !== a.value && (a.value = c), null == b.defaultValue && a.defaultValue !== c && (a.defaultValue = c));
        null != d && (a.defaultValue = "" + d);
      }
      function jb(a) {
        var b = a.textContent;
        b === a._wrapperState.initialValue && "" !== b && null !== b && (a.value = b);
      }
      function kb(a) {
        switch (a) {
          case "svg":
            return "http://www.w3.org/2000/svg";
          case "math":
            return "http://www.w3.org/1998/Math/MathML";
          default:
            return "http://www.w3.org/1999/xhtml";
        }
      }
      function lb(a, b) {
        return null == a || "http://www.w3.org/1999/xhtml" === a ? kb(b) : "http://www.w3.org/2000/svg" === a && "foreignObject" === b ? "http://www.w3.org/1999/xhtml" : a;
      }
      var mb;
      var nb = function(a) {
        return "undefined" !== typeof MSApp && MSApp.execUnsafeLocalFunction ? function(b, c, d, e) {
          MSApp.execUnsafeLocalFunction(function() {
            return a(b, c, d, e);
          });
        } : a;
      }(function(a, b) {
        if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;
        else {
          mb = mb || document.createElement("div");
          mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";
          for (b = mb.firstChild; a.firstChild; ) a.removeChild(a.firstChild);
          for (; b.firstChild; ) a.appendChild(b.firstChild);
        }
      });
      function ob(a, b) {
        if (b) {
          var c = a.firstChild;
          if (c && c === a.lastChild && 3 === c.nodeType) {
            c.nodeValue = b;
            return;
          }
        }
        a.textContent = b;
      }
      var pb = {
        animationIterationCount: true,
        aspectRatio: true,
        borderImageOutset: true,
        borderImageSlice: true,
        borderImageWidth: true,
        boxFlex: true,
        boxFlexGroup: true,
        boxOrdinalGroup: true,
        columnCount: true,
        columns: true,
        flex: true,
        flexGrow: true,
        flexPositive: true,
        flexShrink: true,
        flexNegative: true,
        flexOrder: true,
        gridArea: true,
        gridRow: true,
        gridRowEnd: true,
        gridRowSpan: true,
        gridRowStart: true,
        gridColumn: true,
        gridColumnEnd: true,
        gridColumnSpan: true,
        gridColumnStart: true,
        fontWeight: true,
        lineClamp: true,
        lineHeight: true,
        opacity: true,
        order: true,
        orphans: true,
        tabSize: true,
        widows: true,
        zIndex: true,
        zoom: true,
        fillOpacity: true,
        floodOpacity: true,
        stopOpacity: true,
        strokeDasharray: true,
        strokeDashoffset: true,
        strokeMiterlimit: true,
        strokeOpacity: true,
        strokeWidth: true
      };
      var qb = ["Webkit", "ms", "Moz", "O"];
      Object.keys(pb).forEach(function(a) {
        qb.forEach(function(b) {
          b = b + a.charAt(0).toUpperCase() + a.substring(1);
          pb[b] = pb[a];
        });
      });
      function rb(a, b, c) {
        return null == b || "boolean" === typeof b || "" === b ? "" : c || "number" !== typeof b || 0 === b || pb.hasOwnProperty(a) && pb[a] ? ("" + b).trim() : b + "px";
      }
      function sb(a, b) {
        a = a.style;
        for (var c in b) if (b.hasOwnProperty(c)) {
          var d = 0 === c.indexOf("--"), e = rb(c, b[c], d);
          "float" === c && (c = "cssFloat");
          d ? a.setProperty(c, e) : a[c] = e;
        }
      }
      var tb = A({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
      function ub(a, b) {
        if (b) {
          if (tb[a] && (null != b.children || null != b.dangerouslySetInnerHTML)) throw Error(p(137, a));
          if (null != b.dangerouslySetInnerHTML) {
            if (null != b.children) throw Error(p(60));
            if ("object" !== typeof b.dangerouslySetInnerHTML || !("__html" in b.dangerouslySetInnerHTML)) throw Error(p(61));
          }
          if (null != b.style && "object" !== typeof b.style) throw Error(p(62));
        }
      }
      function vb(a, b) {
        if (-1 === a.indexOf("-")) return "string" === typeof b.is;
        switch (a) {
          case "annotation-xml":
          case "color-profile":
          case "font-face":
          case "font-face-src":
          case "font-face-uri":
          case "font-face-format":
          case "font-face-name":
          case "missing-glyph":
            return false;
          default:
            return true;
        }
      }
      var wb = null;
      function xb(a) {
        a = a.target || a.srcElement || window;
        a.correspondingUseElement && (a = a.correspondingUseElement);
        return 3 === a.nodeType ? a.parentNode : a;
      }
      var yb = null;
      var zb = null;
      var Ab = null;
      function Bb(a) {
        if (a = Cb(a)) {
          if ("function" !== typeof yb) throw Error(p(280));
          var b = a.stateNode;
          b && (b = Db(b), yb(a.stateNode, a.type, b));
        }
      }
      function Eb(a) {
        zb ? Ab ? Ab.push(a) : Ab = [a] : zb = a;
      }
      function Fb() {
        if (zb) {
          var a = zb, b = Ab;
          Ab = zb = null;
          Bb(a);
          if (b) for (a = 0; a < b.length; a++) Bb(b[a]);
        }
      }
      function Gb(a, b) {
        return a(b);
      }
      function Hb() {
      }
      var Ib = false;
      function Jb(a, b, c) {
        if (Ib) return a(b, c);
        Ib = true;
        try {
          return Gb(a, b, c);
        } finally {
          if (Ib = false, null !== zb || null !== Ab) Hb(), Fb();
        }
      }
      function Kb(a, b) {
        var c = a.stateNode;
        if (null === c) return null;
        var d = Db(c);
        if (null === d) return null;
        c = d[b];
        a: switch (b) {
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
            (d = !d.disabled) || (a = a.type, d = !("button" === a || "input" === a || "select" === a || "textarea" === a));
            a = !d;
            break a;
          default:
            a = false;
        }
        if (a) return null;
        if (c && "function" !== typeof c) throw Error(p(231, b, typeof c));
        return c;
      }
      var Lb = false;
      if (ia) try {
        Mb = {};
        Object.defineProperty(Mb, "passive", { get: function() {
          Lb = true;
        } });
        window.addEventListener("test", Mb, Mb);
        window.removeEventListener("test", Mb, Mb);
      } catch (a) {
        Lb = false;
      }
      var Mb;
      function Nb(a, b, c, d, e, f, g, h, k) {
        var l = Array.prototype.slice.call(arguments, 3);
        try {
          b.apply(c, l);
        } catch (m) {
          this.onError(m);
        }
      }
      var Ob = false;
      var Pb = null;
      var Qb = false;
      var Rb = null;
      var Sb = { onError: function(a) {
        Ob = true;
        Pb = a;
      } };
      function Tb(a, b, c, d, e, f, g, h, k) {
        Ob = false;
        Pb = null;
        Nb.apply(Sb, arguments);
      }
      function Ub(a, b, c, d, e, f, g, h, k) {
        Tb.apply(this, arguments);
        if (Ob) {
          if (Ob) {
            var l = Pb;
            Ob = false;
            Pb = null;
          } else throw Error(p(198));
          Qb || (Qb = true, Rb = l);
        }
      }
      function Vb(a) {
        var b = a, c = a;
        if (a.alternate) for (; b.return; ) b = b.return;
        else {
          a = b;
          do
            b = a, 0 !== (b.flags & 4098) && (c = b.return), a = b.return;
          while (a);
        }
        return 3 === b.tag ? c : null;
      }
      function Wb(a) {
        if (13 === a.tag) {
          var b = a.memoizedState;
          null === b && (a = a.alternate, null !== a && (b = a.memoizedState));
          if (null !== b) return b.dehydrated;
        }
        return null;
      }
      function Xb(a) {
        if (Vb(a) !== a) throw Error(p(188));
      }
      function Yb(a) {
        var b = a.alternate;
        if (!b) {
          b = Vb(a);
          if (null === b) throw Error(p(188));
          return b !== a ? null : a;
        }
        for (var c = a, d = b; ; ) {
          var e = c.return;
          if (null === e) break;
          var f = e.alternate;
          if (null === f) {
            d = e.return;
            if (null !== d) {
              c = d;
              continue;
            }
            break;
          }
          if (e.child === f.child) {
            for (f = e.child; f; ) {
              if (f === c) return Xb(e), a;
              if (f === d) return Xb(e), b;
              f = f.sibling;
            }
            throw Error(p(188));
          }
          if (c.return !== d.return) c = e, d = f;
          else {
            for (var g = false, h = e.child; h; ) {
              if (h === c) {
                g = true;
                c = e;
                d = f;
                break;
              }
              if (h === d) {
                g = true;
                d = e;
                c = f;
                break;
              }
              h = h.sibling;
            }
            if (!g) {
              for (h = f.child; h; ) {
                if (h === c) {
                  g = true;
                  c = f;
                  d = e;
                  break;
                }
                if (h === d) {
                  g = true;
                  d = f;
                  c = e;
                  break;
                }
                h = h.sibling;
              }
              if (!g) throw Error(p(189));
            }
          }
          if (c.alternate !== d) throw Error(p(190));
        }
        if (3 !== c.tag) throw Error(p(188));
        return c.stateNode.current === c ? a : b;
      }
      function Zb(a) {
        a = Yb(a);
        return null !== a ? $b(a) : null;
      }
      function $b(a) {
        if (5 === a.tag || 6 === a.tag) return a;
        for (a = a.child; null !== a; ) {
          var b = $b(a);
          if (null !== b) return b;
          a = a.sibling;
        }
        return null;
      }
      var ac = ca.unstable_scheduleCallback;
      var bc = ca.unstable_cancelCallback;
      var cc = ca.unstable_shouldYield;
      var dc = ca.unstable_requestPaint;
      var B = ca.unstable_now;
      var ec = ca.unstable_getCurrentPriorityLevel;
      var fc = ca.unstable_ImmediatePriority;
      var gc = ca.unstable_UserBlockingPriority;
      var hc = ca.unstable_NormalPriority;
      var ic = ca.unstable_LowPriority;
      var jc = ca.unstable_IdlePriority;
      var kc = null;
      var lc = null;
      function mc(a) {
        if (lc && "function" === typeof lc.onCommitFiberRoot) try {
          lc.onCommitFiberRoot(kc, a, void 0, 128 === (a.current.flags & 128));
        } catch (b) {
        }
      }
      var oc = Math.clz32 ? Math.clz32 : nc;
      var pc = Math.log;
      var qc = Math.LN2;
      function nc(a) {
        a >>>= 0;
        return 0 === a ? 32 : 31 - (pc(a) / qc | 0) | 0;
      }
      var rc = 64;
      var sc = 4194304;
      function tc(a) {
        switch (a & -a) {
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
            return a & 4194240;
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
          case 67108864:
            return a & 130023424;
          case 134217728:
            return 134217728;
          case 268435456:
            return 268435456;
          case 536870912:
            return 536870912;
          case 1073741824:
            return 1073741824;
          default:
            return a;
        }
      }
      function uc(a, b) {
        var c = a.pendingLanes;
        if (0 === c) return 0;
        var d = 0, e = a.suspendedLanes, f = a.pingedLanes, g = c & 268435455;
        if (0 !== g) {
          var h = g & ~e;
          0 !== h ? d = tc(h) : (f &= g, 0 !== f && (d = tc(f)));
        } else g = c & ~e, 0 !== g ? d = tc(g) : 0 !== f && (d = tc(f));
        if (0 === d) return 0;
        if (0 !== b && b !== d && 0 === (b & e) && (e = d & -d, f = b & -b, e >= f || 16 === e && 0 !== (f & 4194240))) return b;
        0 !== (d & 4) && (d |= c & 16);
        b = a.entangledLanes;
        if (0 !== b) for (a = a.entanglements, b &= d; 0 < b; ) c = 31 - oc(b), e = 1 << c, d |= a[c], b &= ~e;
        return d;
      }
      function vc(a, b) {
        switch (a) {
          case 1:
          case 2:
          case 4:
            return b + 250;
          case 8:
          case 16:
          case 32:
          case 64:
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
            return b + 5e3;
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
          case 67108864:
            return -1;
          case 134217728:
          case 268435456:
          case 536870912:
          case 1073741824:
            return -1;
          default:
            return -1;
        }
      }
      function wc(a, b) {
        for (var c = a.suspendedLanes, d = a.pingedLanes, e = a.expirationTimes, f = a.pendingLanes; 0 < f; ) {
          var g = 31 - oc(f), h = 1 << g, k = e[g];
          if (-1 === k) {
            if (0 === (h & c) || 0 !== (h & d)) e[g] = vc(h, b);
          } else k <= b && (a.expiredLanes |= h);
          f &= ~h;
        }
      }
      function xc(a) {
        a = a.pendingLanes & -1073741825;
        return 0 !== a ? a : a & 1073741824 ? 1073741824 : 0;
      }
      function yc() {
        var a = rc;
        rc <<= 1;
        0 === (rc & 4194240) && (rc = 64);
        return a;
      }
      function zc(a) {
        for (var b = [], c = 0; 31 > c; c++) b.push(a);
        return b;
      }
      function Ac(a, b, c) {
        a.pendingLanes |= b;
        536870912 !== b && (a.suspendedLanes = 0, a.pingedLanes = 0);
        a = a.eventTimes;
        b = 31 - oc(b);
        a[b] = c;
      }
      function Bc(a, b) {
        var c = a.pendingLanes & ~b;
        a.pendingLanes = b;
        a.suspendedLanes = 0;
        a.pingedLanes = 0;
        a.expiredLanes &= b;
        a.mutableReadLanes &= b;
        a.entangledLanes &= b;
        b = a.entanglements;
        var d = a.eventTimes;
        for (a = a.expirationTimes; 0 < c; ) {
          var e = 31 - oc(c), f = 1 << e;
          b[e] = 0;
          d[e] = -1;
          a[e] = -1;
          c &= ~f;
        }
      }
      function Cc(a, b) {
        var c = a.entangledLanes |= b;
        for (a = a.entanglements; c; ) {
          var d = 31 - oc(c), e = 1 << d;
          e & b | a[d] & b && (a[d] |= b);
          c &= ~e;
        }
      }
      var C = 0;
      function Dc(a) {
        a &= -a;
        return 1 < a ? 4 < a ? 0 !== (a & 268435455) ? 16 : 536870912 : 4 : 1;
      }
      var Ec;
      var Fc;
      var Gc;
      var Hc;
      var Ic;
      var Jc = false;
      var Kc = [];
      var Lc = null;
      var Mc = null;
      var Nc = null;
      var Oc = /* @__PURE__ */ new Map();
      var Pc = /* @__PURE__ */ new Map();
      var Qc = [];
      var Rc = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
      function Sc(a, b) {
        switch (a) {
          case "focusin":
          case "focusout":
            Lc = null;
            break;
          case "dragenter":
          case "dragleave":
            Mc = null;
            break;
          case "mouseover":
          case "mouseout":
            Nc = null;
            break;
          case "pointerover":
          case "pointerout":
            Oc.delete(b.pointerId);
            break;
          case "gotpointercapture":
          case "lostpointercapture":
            Pc.delete(b.pointerId);
        }
      }
      function Tc(a, b, c, d, e, f) {
        if (null === a || a.nativeEvent !== f) return a = { blockedOn: b, domEventName: c, eventSystemFlags: d, nativeEvent: f, targetContainers: [e] }, null !== b && (b = Cb(b), null !== b && Fc(b)), a;
        a.eventSystemFlags |= d;
        b = a.targetContainers;
        null !== e && -1 === b.indexOf(e) && b.push(e);
        return a;
      }
      function Uc(a, b, c, d, e) {
        switch (b) {
          case "focusin":
            return Lc = Tc(Lc, a, b, c, d, e), true;
          case "dragenter":
            return Mc = Tc(Mc, a, b, c, d, e), true;
          case "mouseover":
            return Nc = Tc(Nc, a, b, c, d, e), true;
          case "pointerover":
            var f = e.pointerId;
            Oc.set(f, Tc(Oc.get(f) || null, a, b, c, d, e));
            return true;
          case "gotpointercapture":
            return f = e.pointerId, Pc.set(f, Tc(Pc.get(f) || null, a, b, c, d, e)), true;
        }
        return false;
      }
      function Vc(a) {
        var b = Wc(a.target);
        if (null !== b) {
          var c = Vb(b);
          if (null !== c) {
            if (b = c.tag, 13 === b) {
              if (b = Wb(c), null !== b) {
                a.blockedOn = b;
                Ic(a.priority, function() {
                  Gc(c);
                });
                return;
              }
            } else if (3 === b && c.stateNode.current.memoizedState.isDehydrated) {
              a.blockedOn = 3 === c.tag ? c.stateNode.containerInfo : null;
              return;
            }
          }
        }
        a.blockedOn = null;
      }
      function Xc(a) {
        if (null !== a.blockedOn) return false;
        for (var b = a.targetContainers; 0 < b.length; ) {
          var c = Yc(a.domEventName, a.eventSystemFlags, b[0], a.nativeEvent);
          if (null === c) {
            c = a.nativeEvent;
            var d = new c.constructor(c.type, c);
            wb = d;
            c.target.dispatchEvent(d);
            wb = null;
          } else return b = Cb(c), null !== b && Fc(b), a.blockedOn = c, false;
          b.shift();
        }
        return true;
      }
      function Zc(a, b, c) {
        Xc(a) && c.delete(b);
      }
      function $c() {
        Jc = false;
        null !== Lc && Xc(Lc) && (Lc = null);
        null !== Mc && Xc(Mc) && (Mc = null);
        null !== Nc && Xc(Nc) && (Nc = null);
        Oc.forEach(Zc);
        Pc.forEach(Zc);
      }
      function ad(a, b) {
        a.blockedOn === b && (a.blockedOn = null, Jc || (Jc = true, ca.unstable_scheduleCallback(ca.unstable_NormalPriority, $c)));
      }
      function bd(a) {
        function b(b2) {
          return ad(b2, a);
        }
        if (0 < Kc.length) {
          ad(Kc[0], a);
          for (var c = 1; c < Kc.length; c++) {
            var d = Kc[c];
            d.blockedOn === a && (d.blockedOn = null);
          }
        }
        null !== Lc && ad(Lc, a);
        null !== Mc && ad(Mc, a);
        null !== Nc && ad(Nc, a);
        Oc.forEach(b);
        Pc.forEach(b);
        for (c = 0; c < Qc.length; c++) d = Qc[c], d.blockedOn === a && (d.blockedOn = null);
        for (; 0 < Qc.length && (c = Qc[0], null === c.blockedOn); ) Vc(c), null === c.blockedOn && Qc.shift();
      }
      var cd = ua.ReactCurrentBatchConfig;
      var dd = true;
      function ed(a, b, c, d) {
        var e = C, f = cd.transition;
        cd.transition = null;
        try {
          C = 1, fd(a, b, c, d);
        } finally {
          C = e, cd.transition = f;
        }
      }
      function gd(a, b, c, d) {
        var e = C, f = cd.transition;
        cd.transition = null;
        try {
          C = 4, fd(a, b, c, d);
        } finally {
          C = e, cd.transition = f;
        }
      }
      function fd(a, b, c, d) {
        if (dd) {
          var e = Yc(a, b, c, d);
          if (null === e) hd(a, b, d, id, c), Sc(a, d);
          else if (Uc(e, a, b, c, d)) d.stopPropagation();
          else if (Sc(a, d), b & 4 && -1 < Rc.indexOf(a)) {
            for (; null !== e; ) {
              var f = Cb(e);
              null !== f && Ec(f);
              f = Yc(a, b, c, d);
              null === f && hd(a, b, d, id, c);
              if (f === e) break;
              e = f;
            }
            null !== e && d.stopPropagation();
          } else hd(a, b, d, null, c);
        }
      }
      var id = null;
      function Yc(a, b, c, d) {
        id = null;
        a = xb(d);
        a = Wc(a);
        if (null !== a) if (b = Vb(a), null === b) a = null;
        else if (c = b.tag, 13 === c) {
          a = Wb(b);
          if (null !== a) return a;
          a = null;
        } else if (3 === c) {
          if (b.stateNode.current.memoizedState.isDehydrated) return 3 === b.tag ? b.stateNode.containerInfo : null;
          a = null;
        } else b !== a && (a = null);
        id = a;
        return null;
      }
      function jd(a) {
        switch (a) {
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
            return 1;
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
          case "toggle":
          case "touchmove":
          case "wheel":
          case "mouseenter":
          case "mouseleave":
          case "pointerenter":
          case "pointerleave":
            return 4;
          case "message":
            switch (ec()) {
              case fc:
                return 1;
              case gc:
                return 4;
              case hc:
              case ic:
                return 16;
              case jc:
                return 536870912;
              default:
                return 16;
            }
          default:
            return 16;
        }
      }
      var kd = null;
      var ld = null;
      var md = null;
      function nd() {
        if (md) return md;
        var a, b = ld, c = b.length, d, e = "value" in kd ? kd.value : kd.textContent, f = e.length;
        for (a = 0; a < c && b[a] === e[a]; a++) ;
        var g = c - a;
        for (d = 1; d <= g && b[c - d] === e[f - d]; d++) ;
        return md = e.slice(a, 1 < d ? 1 - d : void 0);
      }
      function od(a) {
        var b = a.keyCode;
        "charCode" in a ? (a = a.charCode, 0 === a && 13 === b && (a = 13)) : a = b;
        10 === a && (a = 13);
        return 32 <= a || 13 === a ? a : 0;
      }
      function pd() {
        return true;
      }
      function qd() {
        return false;
      }
      function rd(a) {
        function b(b2, d, e, f, g) {
          this._reactName = b2;
          this._targetInst = e;
          this.type = d;
          this.nativeEvent = f;
          this.target = g;
          this.currentTarget = null;
          for (var c in a) a.hasOwnProperty(c) && (b2 = a[c], this[c] = b2 ? b2(f) : f[c]);
          this.isDefaultPrevented = (null != f.defaultPrevented ? f.defaultPrevented : false === f.returnValue) ? pd : qd;
          this.isPropagationStopped = qd;
          return this;
        }
        A(b.prototype, { preventDefault: function() {
          this.defaultPrevented = true;
          var a2 = this.nativeEvent;
          a2 && (a2.preventDefault ? a2.preventDefault() : "unknown" !== typeof a2.returnValue && (a2.returnValue = false), this.isDefaultPrevented = pd);
        }, stopPropagation: function() {
          var a2 = this.nativeEvent;
          a2 && (a2.stopPropagation ? a2.stopPropagation() : "unknown" !== typeof a2.cancelBubble && (a2.cancelBubble = true), this.isPropagationStopped = pd);
        }, persist: function() {
        }, isPersistent: pd });
        return b;
      }
      var sd = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(a) {
        return a.timeStamp || Date.now();
      }, defaultPrevented: 0, isTrusted: 0 };
      var td = rd(sd);
      var ud = A({}, sd, { view: 0, detail: 0 });
      var vd = rd(ud);
      var wd;
      var xd;
      var yd;
      var Ad = A({}, ud, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zd, button: 0, buttons: 0, relatedTarget: function(a) {
        return void 0 === a.relatedTarget ? a.fromElement === a.srcElement ? a.toElement : a.fromElement : a.relatedTarget;
      }, movementX: function(a) {
        if ("movementX" in a) return a.movementX;
        a !== yd && (yd && "mousemove" === a.type ? (wd = a.screenX - yd.screenX, xd = a.screenY - yd.screenY) : xd = wd = 0, yd = a);
        return wd;
      }, movementY: function(a) {
        return "movementY" in a ? a.movementY : xd;
      } });
      var Bd = rd(Ad);
      var Cd = A({}, Ad, { dataTransfer: 0 });
      var Dd = rd(Cd);
      var Ed = A({}, ud, { relatedTarget: 0 });
      var Fd = rd(Ed);
      var Gd = A({}, sd, { animationName: 0, elapsedTime: 0, pseudoElement: 0 });
      var Hd = rd(Gd);
      var Id = A({}, sd, { clipboardData: function(a) {
        return "clipboardData" in a ? a.clipboardData : window.clipboardData;
      } });
      var Jd = rd(Id);
      var Kd = A({}, sd, { data: 0 });
      var Ld = rd(Kd);
      var Md = {
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
      };
      var Nd = {
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
      };
      var Od = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
      function Pd(a) {
        var b = this.nativeEvent;
        return b.getModifierState ? b.getModifierState(a) : (a = Od[a]) ? !!b[a] : false;
      }
      function zd() {
        return Pd;
      }
      var Qd = A({}, ud, { key: function(a) {
        if (a.key) {
          var b = Md[a.key] || a.key;
          if ("Unidentified" !== b) return b;
        }
        return "keypress" === a.type ? (a = od(a), 13 === a ? "Enter" : String.fromCharCode(a)) : "keydown" === a.type || "keyup" === a.type ? Nd[a.keyCode] || "Unidentified" : "";
      }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zd, charCode: function(a) {
        return "keypress" === a.type ? od(a) : 0;
      }, keyCode: function(a) {
        return "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
      }, which: function(a) {
        return "keypress" === a.type ? od(a) : "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
      } });
      var Rd = rd(Qd);
      var Sd = A({}, Ad, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 });
      var Td = rd(Sd);
      var Ud = A({}, ud, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zd });
      var Vd = rd(Ud);
      var Wd = A({}, sd, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 });
      var Xd = rd(Wd);
      var Yd = A({}, Ad, {
        deltaX: function(a) {
          return "deltaX" in a ? a.deltaX : "wheelDeltaX" in a ? -a.wheelDeltaX : 0;
        },
        deltaY: function(a) {
          return "deltaY" in a ? a.deltaY : "wheelDeltaY" in a ? -a.wheelDeltaY : "wheelDelta" in a ? -a.wheelDelta : 0;
        },
        deltaZ: 0,
        deltaMode: 0
      });
      var Zd = rd(Yd);
      var $d = [9, 13, 27, 32];
      var ae = ia && "CompositionEvent" in window;
      var be = null;
      ia && "documentMode" in document && (be = document.documentMode);
      var ce = ia && "TextEvent" in window && !be;
      var de = ia && (!ae || be && 8 < be && 11 >= be);
      var ee = String.fromCharCode(32);
      var fe = false;
      function ge(a, b) {
        switch (a) {
          case "keyup":
            return -1 !== $d.indexOf(b.keyCode);
          case "keydown":
            return 229 !== b.keyCode;
          case "keypress":
          case "mousedown":
          case "focusout":
            return true;
          default:
            return false;
        }
      }
      function he(a) {
        a = a.detail;
        return "object" === typeof a && "data" in a ? a.data : null;
      }
      var ie = false;
      function je(a, b) {
        switch (a) {
          case "compositionend":
            return he(b);
          case "keypress":
            if (32 !== b.which) return null;
            fe = true;
            return ee;
          case "textInput":
            return a = b.data, a === ee && fe ? null : a;
          default:
            return null;
        }
      }
      function ke(a, b) {
        if (ie) return "compositionend" === a || !ae && ge(a, b) ? (a = nd(), md = ld = kd = null, ie = false, a) : null;
        switch (a) {
          case "paste":
            return null;
          case "keypress":
            if (!(b.ctrlKey || b.altKey || b.metaKey) || b.ctrlKey && b.altKey) {
              if (b.char && 1 < b.char.length) return b.char;
              if (b.which) return String.fromCharCode(b.which);
            }
            return null;
          case "compositionend":
            return de && "ko" !== b.locale ? null : b.data;
          default:
            return null;
        }
      }
      var le = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
      function me(a) {
        var b = a && a.nodeName && a.nodeName.toLowerCase();
        return "input" === b ? !!le[a.type] : "textarea" === b ? true : false;
      }
      function ne(a, b, c, d) {
        Eb(d);
        b = oe(b, "onChange");
        0 < b.length && (c = new td("onChange", "change", null, c, d), a.push({ event: c, listeners: b }));
      }
      var pe = null;
      var qe = null;
      function re(a) {
        se(a, 0);
      }
      function te(a) {
        var b = ue(a);
        if (Wa(b)) return a;
      }
      function ve(a, b) {
        if ("change" === a) return b;
      }
      var we = false;
      if (ia) {
        if (ia) {
          ye = "oninput" in document;
          if (!ye) {
            ze = document.createElement("div");
            ze.setAttribute("oninput", "return;");
            ye = "function" === typeof ze.oninput;
          }
          xe = ye;
        } else xe = false;
        we = xe && (!document.documentMode || 9 < document.documentMode);
      }
      var xe;
      var ye;
      var ze;
      function Ae() {
        pe && (pe.detachEvent("onpropertychange", Be), qe = pe = null);
      }
      function Be(a) {
        if ("value" === a.propertyName && te(qe)) {
          var b = [];
          ne(b, qe, a, xb(a));
          Jb(re, b);
        }
      }
      function Ce(a, b, c) {
        "focusin" === a ? (Ae(), pe = b, qe = c, pe.attachEvent("onpropertychange", Be)) : "focusout" === a && Ae();
      }
      function De(a) {
        if ("selectionchange" === a || "keyup" === a || "keydown" === a) return te(qe);
      }
      function Ee(a, b) {
        if ("click" === a) return te(b);
      }
      function Fe(a, b) {
        if ("input" === a || "change" === a) return te(b);
      }
      function Ge(a, b) {
        return a === b && (0 !== a || 1 / a === 1 / b) || a !== a && b !== b;
      }
      var He = "function" === typeof Object.is ? Object.is : Ge;
      function Ie(a, b) {
        if (He(a, b)) return true;
        if ("object" !== typeof a || null === a || "object" !== typeof b || null === b) return false;
        var c = Object.keys(a), d = Object.keys(b);
        if (c.length !== d.length) return false;
        for (d = 0; d < c.length; d++) {
          var e = c[d];
          if (!ja.call(b, e) || !He(a[e], b[e])) return false;
        }
        return true;
      }
      function Je(a) {
        for (; a && a.firstChild; ) a = a.firstChild;
        return a;
      }
      function Ke(a, b) {
        var c = Je(a);
        a = 0;
        for (var d; c; ) {
          if (3 === c.nodeType) {
            d = a + c.textContent.length;
            if (a <= b && d >= b) return { node: c, offset: b - a };
            a = d;
          }
          a: {
            for (; c; ) {
              if (c.nextSibling) {
                c = c.nextSibling;
                break a;
              }
              c = c.parentNode;
            }
            c = void 0;
          }
          c = Je(c);
        }
      }
      function Le(a, b) {
        return a && b ? a === b ? true : a && 3 === a.nodeType ? false : b && 3 === b.nodeType ? Le(a, b.parentNode) : "contains" in a ? a.contains(b) : a.compareDocumentPosition ? !!(a.compareDocumentPosition(b) & 16) : false : false;
      }
      function Me() {
        for (var a = window, b = Xa(); b instanceof a.HTMLIFrameElement; ) {
          try {
            var c = "string" === typeof b.contentWindow.location.href;
          } catch (d) {
            c = false;
          }
          if (c) a = b.contentWindow;
          else break;
          b = Xa(a.document);
        }
        return b;
      }
      function Ne(a) {
        var b = a && a.nodeName && a.nodeName.toLowerCase();
        return b && ("input" === b && ("text" === a.type || "search" === a.type || "tel" === a.type || "url" === a.type || "password" === a.type) || "textarea" === b || "true" === a.contentEditable);
      }
      function Oe(a) {
        var b = Me(), c = a.focusedElem, d = a.selectionRange;
        if (b !== c && c && c.ownerDocument && Le(c.ownerDocument.documentElement, c)) {
          if (null !== d && Ne(c)) {
            if (b = d.start, a = d.end, void 0 === a && (a = b), "selectionStart" in c) c.selectionStart = b, c.selectionEnd = Math.min(a, c.value.length);
            else if (a = (b = c.ownerDocument || document) && b.defaultView || window, a.getSelection) {
              a = a.getSelection();
              var e = c.textContent.length, f = Math.min(d.start, e);
              d = void 0 === d.end ? f : Math.min(d.end, e);
              !a.extend && f > d && (e = d, d = f, f = e);
              e = Ke(c, f);
              var g = Ke(
                c,
                d
              );
              e && g && (1 !== a.rangeCount || a.anchorNode !== e.node || a.anchorOffset !== e.offset || a.focusNode !== g.node || a.focusOffset !== g.offset) && (b = b.createRange(), b.setStart(e.node, e.offset), a.removeAllRanges(), f > d ? (a.addRange(b), a.extend(g.node, g.offset)) : (b.setEnd(g.node, g.offset), a.addRange(b)));
            }
          }
          b = [];
          for (a = c; a = a.parentNode; ) 1 === a.nodeType && b.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
          "function" === typeof c.focus && c.focus();
          for (c = 0; c < b.length; c++) a = b[c], a.element.scrollLeft = a.left, a.element.scrollTop = a.top;
        }
      }
      var Pe = ia && "documentMode" in document && 11 >= document.documentMode;
      var Qe = null;
      var Re = null;
      var Se = null;
      var Te = false;
      function Ue(a, b, c) {
        var d = c.window === c ? c.document : 9 === c.nodeType ? c : c.ownerDocument;
        Te || null == Qe || Qe !== Xa(d) || (d = Qe, "selectionStart" in d && Ne(d) ? d = { start: d.selectionStart, end: d.selectionEnd } : (d = (d.ownerDocument && d.ownerDocument.defaultView || window).getSelection(), d = { anchorNode: d.anchorNode, anchorOffset: d.anchorOffset, focusNode: d.focusNode, focusOffset: d.focusOffset }), Se && Ie(Se, d) || (Se = d, d = oe(Re, "onSelect"), 0 < d.length && (b = new td("onSelect", "select", null, b, c), a.push({ event: b, listeners: d }), b.target = Qe)));
      }
      function Ve(a, b) {
        var c = {};
        c[a.toLowerCase()] = b.toLowerCase();
        c["Webkit" + a] = "webkit" + b;
        c["Moz" + a] = "moz" + b;
        return c;
      }
      var We = { animationend: Ve("Animation", "AnimationEnd"), animationiteration: Ve("Animation", "AnimationIteration"), animationstart: Ve("Animation", "AnimationStart"), transitionend: Ve("Transition", "TransitionEnd") };
      var Xe = {};
      var Ye = {};
      ia && (Ye = document.createElement("div").style, "AnimationEvent" in window || (delete We.animationend.animation, delete We.animationiteration.animation, delete We.animationstart.animation), "TransitionEvent" in window || delete We.transitionend.transition);
      function Ze(a) {
        if (Xe[a]) return Xe[a];
        if (!We[a]) return a;
        var b = We[a], c;
        for (c in b) if (b.hasOwnProperty(c) && c in Ye) return Xe[a] = b[c];
        return a;
      }
      var $e = Ze("animationend");
      var af = Ze("animationiteration");
      var bf = Ze("animationstart");
      var cf = Ze("transitionend");
      var df = /* @__PURE__ */ new Map();
      var ef = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
      function ff(a, b) {
        df.set(a, b);
        fa(b, [a]);
      }
      for (gf = 0; gf < ef.length; gf++) {
        hf = ef[gf], jf = hf.toLowerCase(), kf = hf[0].toUpperCase() + hf.slice(1);
        ff(jf, "on" + kf);
      }
      var hf;
      var jf;
      var kf;
      var gf;
      ff($e, "onAnimationEnd");
      ff(af, "onAnimationIteration");
      ff(bf, "onAnimationStart");
      ff("dblclick", "onDoubleClick");
      ff("focusin", "onFocus");
      ff("focusout", "onBlur");
      ff(cf, "onTransitionEnd");
      ha("onMouseEnter", ["mouseout", "mouseover"]);
      ha("onMouseLeave", ["mouseout", "mouseover"]);
      ha("onPointerEnter", ["pointerout", "pointerover"]);
      ha("onPointerLeave", ["pointerout", "pointerover"]);
      fa("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
      fa("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
      fa("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
      fa("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
      fa("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
      fa("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
      var lf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ");
      var mf = new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));
      function nf(a, b, c) {
        var d = a.type || "unknown-event";
        a.currentTarget = c;
        Ub(d, b, void 0, a);
        a.currentTarget = null;
      }
      function se(a, b) {
        b = 0 !== (b & 4);
        for (var c = 0; c < a.length; c++) {
          var d = a[c], e = d.event;
          d = d.listeners;
          a: {
            var f = void 0;
            if (b) for (var g = d.length - 1; 0 <= g; g--) {
              var h = d[g], k = h.instance, l = h.currentTarget;
              h = h.listener;
              if (k !== f && e.isPropagationStopped()) break a;
              nf(e, h, l);
              f = k;
            }
            else for (g = 0; g < d.length; g++) {
              h = d[g];
              k = h.instance;
              l = h.currentTarget;
              h = h.listener;
              if (k !== f && e.isPropagationStopped()) break a;
              nf(e, h, l);
              f = k;
            }
          }
        }
        if (Qb) throw a = Rb, Qb = false, Rb = null, a;
      }
      function D(a, b) {
        var c = b[of];
        void 0 === c && (c = b[of] = /* @__PURE__ */ new Set());
        var d = a + "__bubble";
        c.has(d) || (pf(b, a, 2, false), c.add(d));
      }
      function qf(a, b, c) {
        var d = 0;
        b && (d |= 4);
        pf(c, a, d, b);
      }
      var rf = "_reactListening" + Math.random().toString(36).slice(2);
      function sf(a) {
        if (!a[rf]) {
          a[rf] = true;
          da.forEach(function(b2) {
            "selectionchange" !== b2 && (mf.has(b2) || qf(b2, false, a), qf(b2, true, a));
          });
          var b = 9 === a.nodeType ? a : a.ownerDocument;
          null === b || b[rf] || (b[rf] = true, qf("selectionchange", false, b));
        }
      }
      function pf(a, b, c, d) {
        switch (jd(b)) {
          case 1:
            var e = ed;
            break;
          case 4:
            e = gd;
            break;
          default:
            e = fd;
        }
        c = e.bind(null, b, c, a);
        e = void 0;
        !Lb || "touchstart" !== b && "touchmove" !== b && "wheel" !== b || (e = true);
        d ? void 0 !== e ? a.addEventListener(b, c, { capture: true, passive: e }) : a.addEventListener(b, c, true) : void 0 !== e ? a.addEventListener(b, c, { passive: e }) : a.addEventListener(b, c, false);
      }
      function hd(a, b, c, d, e) {
        var f = d;
        if (0 === (b & 1) && 0 === (b & 2) && null !== d) a: for (; ; ) {
          if (null === d) return;
          var g = d.tag;
          if (3 === g || 4 === g) {
            var h = d.stateNode.containerInfo;
            if (h === e || 8 === h.nodeType && h.parentNode === e) break;
            if (4 === g) for (g = d.return; null !== g; ) {
              var k = g.tag;
              if (3 === k || 4 === k) {
                if (k = g.stateNode.containerInfo, k === e || 8 === k.nodeType && k.parentNode === e) return;
              }
              g = g.return;
            }
            for (; null !== h; ) {
              g = Wc(h);
              if (null === g) return;
              k = g.tag;
              if (5 === k || 6 === k) {
                d = f = g;
                continue a;
              }
              h = h.parentNode;
            }
          }
          d = d.return;
        }
        Jb(function() {
          var d2 = f, e2 = xb(c), g2 = [];
          a: {
            var h2 = df.get(a);
            if (void 0 !== h2) {
              var k2 = td, n = a;
              switch (a) {
                case "keypress":
                  if (0 === od(c)) break a;
                case "keydown":
                case "keyup":
                  k2 = Rd;
                  break;
                case "focusin":
                  n = "focus";
                  k2 = Fd;
                  break;
                case "focusout":
                  n = "blur";
                  k2 = Fd;
                  break;
                case "beforeblur":
                case "afterblur":
                  k2 = Fd;
                  break;
                case "click":
                  if (2 === c.button) break a;
                case "auxclick":
                case "dblclick":
                case "mousedown":
                case "mousemove":
                case "mouseup":
                case "mouseout":
                case "mouseover":
                case "contextmenu":
                  k2 = Bd;
                  break;
                case "drag":
                case "dragend":
                case "dragenter":
                case "dragexit":
                case "dragleave":
                case "dragover":
                case "dragstart":
                case "drop":
                  k2 = Dd;
                  break;
                case "touchcancel":
                case "touchend":
                case "touchmove":
                case "touchstart":
                  k2 = Vd;
                  break;
                case $e:
                case af:
                case bf:
                  k2 = Hd;
                  break;
                case cf:
                  k2 = Xd;
                  break;
                case "scroll":
                  k2 = vd;
                  break;
                case "wheel":
                  k2 = Zd;
                  break;
                case "copy":
                case "cut":
                case "paste":
                  k2 = Jd;
                  break;
                case "gotpointercapture":
                case "lostpointercapture":
                case "pointercancel":
                case "pointerdown":
                case "pointermove":
                case "pointerout":
                case "pointerover":
                case "pointerup":
                  k2 = Td;
              }
              var t3 = 0 !== (b & 4), J = !t3 && "scroll" === a, x = t3 ? null !== h2 ? h2 + "Capture" : null : h2;
              t3 = [];
              for (var w = d2, u; null !== w; ) {
                u = w;
                var F = u.stateNode;
                5 === u.tag && null !== F && (u = F, null !== x && (F = Kb(w, x), null != F && t3.push(tf(w, F, u))));
                if (J) break;
                w = w.return;
              }
              0 < t3.length && (h2 = new k2(h2, n, null, c, e2), g2.push({ event: h2, listeners: t3 }));
            }
          }
          if (0 === (b & 7)) {
            a: {
              h2 = "mouseover" === a || "pointerover" === a;
              k2 = "mouseout" === a || "pointerout" === a;
              if (h2 && c !== wb && (n = c.relatedTarget || c.fromElement) && (Wc(n) || n[uf])) break a;
              if (k2 || h2) {
                h2 = e2.window === e2 ? e2 : (h2 = e2.ownerDocument) ? h2.defaultView || h2.parentWindow : window;
                if (k2) {
                  if (n = c.relatedTarget || c.toElement, k2 = d2, n = n ? Wc(n) : null, null !== n && (J = Vb(n), n !== J || 5 !== n.tag && 6 !== n.tag)) n = null;
                } else k2 = null, n = d2;
                if (k2 !== n) {
                  t3 = Bd;
                  F = "onMouseLeave";
                  x = "onMouseEnter";
                  w = "mouse";
                  if ("pointerout" === a || "pointerover" === a) t3 = Td, F = "onPointerLeave", x = "onPointerEnter", w = "pointer";
                  J = null == k2 ? h2 : ue(k2);
                  u = null == n ? h2 : ue(n);
                  h2 = new t3(F, w + "leave", k2, c, e2);
                  h2.target = J;
                  h2.relatedTarget = u;
                  F = null;
                  Wc(e2) === d2 && (t3 = new t3(x, w + "enter", n, c, e2), t3.target = u, t3.relatedTarget = J, F = t3);
                  J = F;
                  if (k2 && n) b: {
                    t3 = k2;
                    x = n;
                    w = 0;
                    for (u = t3; u; u = vf(u)) w++;
                    u = 0;
                    for (F = x; F; F = vf(F)) u++;
                    for (; 0 < w - u; ) t3 = vf(t3), w--;
                    for (; 0 < u - w; ) x = vf(x), u--;
                    for (; w--; ) {
                      if (t3 === x || null !== x && t3 === x.alternate) break b;
                      t3 = vf(t3);
                      x = vf(x);
                    }
                    t3 = null;
                  }
                  else t3 = null;
                  null !== k2 && wf(g2, h2, k2, t3, false);
                  null !== n && null !== J && wf(g2, J, n, t3, true);
                }
              }
            }
            a: {
              h2 = d2 ? ue(d2) : window;
              k2 = h2.nodeName && h2.nodeName.toLowerCase();
              if ("select" === k2 || "input" === k2 && "file" === h2.type) var na = ve;
              else if (me(h2)) if (we) na = Fe;
              else {
                na = De;
                var xa = Ce;
              }
              else (k2 = h2.nodeName) && "input" === k2.toLowerCase() && ("checkbox" === h2.type || "radio" === h2.type) && (na = Ee);
              if (na && (na = na(a, d2))) {
                ne(g2, na, c, e2);
                break a;
              }
              xa && xa(a, h2, d2);
              "focusout" === a && (xa = h2._wrapperState) && xa.controlled && "number" === h2.type && cb(h2, "number", h2.value);
            }
            xa = d2 ? ue(d2) : window;
            switch (a) {
              case "focusin":
                if (me(xa) || "true" === xa.contentEditable) Qe = xa, Re = d2, Se = null;
                break;
              case "focusout":
                Se = Re = Qe = null;
                break;
              case "mousedown":
                Te = true;
                break;
              case "contextmenu":
              case "mouseup":
              case "dragend":
                Te = false;
                Ue(g2, c, e2);
                break;
              case "selectionchange":
                if (Pe) break;
              case "keydown":
              case "keyup":
                Ue(g2, c, e2);
            }
            var $a;
            if (ae) b: {
              switch (a) {
                case "compositionstart":
                  var ba = "onCompositionStart";
                  break b;
                case "compositionend":
                  ba = "onCompositionEnd";
                  break b;
                case "compositionupdate":
                  ba = "onCompositionUpdate";
                  break b;
              }
              ba = void 0;
            }
            else ie ? ge(a, c) && (ba = "onCompositionEnd") : "keydown" === a && 229 === c.keyCode && (ba = "onCompositionStart");
            ba && (de && "ko" !== c.locale && (ie || "onCompositionStart" !== ba ? "onCompositionEnd" === ba && ie && ($a = nd()) : (kd = e2, ld = "value" in kd ? kd.value : kd.textContent, ie = true)), xa = oe(d2, ba), 0 < xa.length && (ba = new Ld(ba, a, null, c, e2), g2.push({ event: ba, listeners: xa }), $a ? ba.data = $a : ($a = he(c), null !== $a && (ba.data = $a))));
            if ($a = ce ? je(a, c) : ke(a, c)) d2 = oe(d2, "onBeforeInput"), 0 < d2.length && (e2 = new Ld("onBeforeInput", "beforeinput", null, c, e2), g2.push({ event: e2, listeners: d2 }), e2.data = $a);
          }
          se(g2, b);
        });
      }
      function tf(a, b, c) {
        return { instance: a, listener: b, currentTarget: c };
      }
      function oe(a, b) {
        for (var c = b + "Capture", d = []; null !== a; ) {
          var e = a, f = e.stateNode;
          5 === e.tag && null !== f && (e = f, f = Kb(a, c), null != f && d.unshift(tf(a, f, e)), f = Kb(a, b), null != f && d.push(tf(a, f, e)));
          a = a.return;
        }
        return d;
      }
      function vf(a) {
        if (null === a) return null;
        do
          a = a.return;
        while (a && 5 !== a.tag);
        return a ? a : null;
      }
      function wf(a, b, c, d, e) {
        for (var f = b._reactName, g = []; null !== c && c !== d; ) {
          var h = c, k = h.alternate, l = h.stateNode;
          if (null !== k && k === d) break;
          5 === h.tag && null !== l && (h = l, e ? (k = Kb(c, f), null != k && g.unshift(tf(c, k, h))) : e || (k = Kb(c, f), null != k && g.push(tf(c, k, h))));
          c = c.return;
        }
        0 !== g.length && a.push({ event: b, listeners: g });
      }
      var xf = /\r\n?/g;
      var yf = /\u0000|\uFFFD/g;
      function zf(a) {
        return ("string" === typeof a ? a : "" + a).replace(xf, "\n").replace(yf, "");
      }
      function Af(a, b, c) {
        b = zf(b);
        if (zf(a) !== b && c) throw Error(p(425));
      }
      function Bf() {
      }
      var Cf = null;
      var Df = null;
      function Ef(a, b) {
        return "textarea" === a || "noscript" === a || "string" === typeof b.children || "number" === typeof b.children || "object" === typeof b.dangerouslySetInnerHTML && null !== b.dangerouslySetInnerHTML && null != b.dangerouslySetInnerHTML.__html;
      }
      var Ff = "function" === typeof setTimeout ? setTimeout : void 0;
      var Gf = "function" === typeof clearTimeout ? clearTimeout : void 0;
      var Hf = "function" === typeof Promise ? Promise : void 0;
      var Jf = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof Hf ? function(a) {
        return Hf.resolve(null).then(a).catch(If);
      } : Ff;
      function If(a) {
        setTimeout(function() {
          throw a;
        });
      }
      function Kf(a, b) {
        var c = b, d = 0;
        do {
          var e = c.nextSibling;
          a.removeChild(c);
          if (e && 8 === e.nodeType) if (c = e.data, "/$" === c) {
            if (0 === d) {
              a.removeChild(e);
              bd(b);
              return;
            }
            d--;
          } else "$" !== c && "$?" !== c && "$!" !== c || d++;
          c = e;
        } while (c);
        bd(b);
      }
      function Lf(a) {
        for (; null != a; a = a.nextSibling) {
          var b = a.nodeType;
          if (1 === b || 3 === b) break;
          if (8 === b) {
            b = a.data;
            if ("$" === b || "$!" === b || "$?" === b) break;
            if ("/$" === b) return null;
          }
        }
        return a;
      }
      function Mf(a) {
        a = a.previousSibling;
        for (var b = 0; a; ) {
          if (8 === a.nodeType) {
            var c = a.data;
            if ("$" === c || "$!" === c || "$?" === c) {
              if (0 === b) return a;
              b--;
            } else "/$" === c && b++;
          }
          a = a.previousSibling;
        }
        return null;
      }
      var Nf = Math.random().toString(36).slice(2);
      var Of = "__reactFiber$" + Nf;
      var Pf = "__reactProps$" + Nf;
      var uf = "__reactContainer$" + Nf;
      var of = "__reactEvents$" + Nf;
      var Qf = "__reactListeners$" + Nf;
      var Rf = "__reactHandles$" + Nf;
      function Wc(a) {
        var b = a[Of];
        if (b) return b;
        for (var c = a.parentNode; c; ) {
          if (b = c[uf] || c[Of]) {
            c = b.alternate;
            if (null !== b.child || null !== c && null !== c.child) for (a = Mf(a); null !== a; ) {
              if (c = a[Of]) return c;
              a = Mf(a);
            }
            return b;
          }
          a = c;
          c = a.parentNode;
        }
        return null;
      }
      function Cb(a) {
        a = a[Of] || a[uf];
        return !a || 5 !== a.tag && 6 !== a.tag && 13 !== a.tag && 3 !== a.tag ? null : a;
      }
      function ue(a) {
        if (5 === a.tag || 6 === a.tag) return a.stateNode;
        throw Error(p(33));
      }
      function Db(a) {
        return a[Pf] || null;
      }
      var Sf = [];
      var Tf = -1;
      function Uf(a) {
        return { current: a };
      }
      function E(a) {
        0 > Tf || (a.current = Sf[Tf], Sf[Tf] = null, Tf--);
      }
      function G(a, b) {
        Tf++;
        Sf[Tf] = a.current;
        a.current = b;
      }
      var Vf = {};
      var H = Uf(Vf);
      var Wf = Uf(false);
      var Xf = Vf;
      function Yf(a, b) {
        var c = a.type.contextTypes;
        if (!c) return Vf;
        var d = a.stateNode;
        if (d && d.__reactInternalMemoizedUnmaskedChildContext === b) return d.__reactInternalMemoizedMaskedChildContext;
        var e = {}, f;
        for (f in c) e[f] = b[f];
        d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = b, a.__reactInternalMemoizedMaskedChildContext = e);
        return e;
      }
      function Zf(a) {
        a = a.childContextTypes;
        return null !== a && void 0 !== a;
      }
      function $f() {
        E(Wf);
        E(H);
      }
      function ag(a, b, c) {
        if (H.current !== Vf) throw Error(p(168));
        G(H, b);
        G(Wf, c);
      }
      function bg(a, b, c) {
        var d = a.stateNode;
        b = b.childContextTypes;
        if ("function" !== typeof d.getChildContext) return c;
        d = d.getChildContext();
        for (var e in d) if (!(e in b)) throw Error(p(108, Ra(a) || "Unknown", e));
        return A({}, c, d);
      }
      function cg(a) {
        a = (a = a.stateNode) && a.__reactInternalMemoizedMergedChildContext || Vf;
        Xf = H.current;
        G(H, a);
        G(Wf, Wf.current);
        return true;
      }
      function dg(a, b, c) {
        var d = a.stateNode;
        if (!d) throw Error(p(169));
        c ? (a = bg(a, b, Xf), d.__reactInternalMemoizedMergedChildContext = a, E(Wf), E(H), G(H, a)) : E(Wf);
        G(Wf, c);
      }
      var eg = null;
      var fg = false;
      var gg = false;
      function hg(a) {
        null === eg ? eg = [a] : eg.push(a);
      }
      function ig(a) {
        fg = true;
        hg(a);
      }
      function jg() {
        if (!gg && null !== eg) {
          gg = true;
          var a = 0, b = C;
          try {
            var c = eg;
            for (C = 1; a < c.length; a++) {
              var d = c[a];
              do
                d = d(true);
              while (null !== d);
            }
            eg = null;
            fg = false;
          } catch (e) {
            throw null !== eg && (eg = eg.slice(a + 1)), ac(fc, jg), e;
          } finally {
            C = b, gg = false;
          }
        }
        return null;
      }
      var kg = [];
      var lg = 0;
      var mg = null;
      var ng = 0;
      var og = [];
      var pg = 0;
      var qg = null;
      var rg = 1;
      var sg = "";
      function tg(a, b) {
        kg[lg++] = ng;
        kg[lg++] = mg;
        mg = a;
        ng = b;
      }
      function ug(a, b, c) {
        og[pg++] = rg;
        og[pg++] = sg;
        og[pg++] = qg;
        qg = a;
        var d = rg;
        a = sg;
        var e = 32 - oc(d) - 1;
        d &= ~(1 << e);
        c += 1;
        var f = 32 - oc(b) + e;
        if (30 < f) {
          var g = e - e % 5;
          f = (d & (1 << g) - 1).toString(32);
          d >>= g;
          e -= g;
          rg = 1 << 32 - oc(b) + e | c << e | d;
          sg = f + a;
        } else rg = 1 << f | c << e | d, sg = a;
      }
      function vg(a) {
        null !== a.return && (tg(a, 1), ug(a, 1, 0));
      }
      function wg(a) {
        for (; a === mg; ) mg = kg[--lg], kg[lg] = null, ng = kg[--lg], kg[lg] = null;
        for (; a === qg; ) qg = og[--pg], og[pg] = null, sg = og[--pg], og[pg] = null, rg = og[--pg], og[pg] = null;
      }
      var xg = null;
      var yg = null;
      var I = false;
      var zg = null;
      function Ag(a, b) {
        var c = Bg(5, null, null, 0);
        c.elementType = "DELETED";
        c.stateNode = b;
        c.return = a;
        b = a.deletions;
        null === b ? (a.deletions = [c], a.flags |= 16) : b.push(c);
      }
      function Cg(a, b) {
        switch (a.tag) {
          case 5:
            var c = a.type;
            b = 1 !== b.nodeType || c.toLowerCase() !== b.nodeName.toLowerCase() ? null : b;
            return null !== b ? (a.stateNode = b, xg = a, yg = Lf(b.firstChild), true) : false;
          case 6:
            return b = "" === a.pendingProps || 3 !== b.nodeType ? null : b, null !== b ? (a.stateNode = b, xg = a, yg = null, true) : false;
          case 13:
            return b = 8 !== b.nodeType ? null : b, null !== b ? (c = null !== qg ? { id: rg, overflow: sg } : null, a.memoizedState = { dehydrated: b, treeContext: c, retryLane: 1073741824 }, c = Bg(18, null, null, 0), c.stateNode = b, c.return = a, a.child = c, xg = a, yg = null, true) : false;
          default:
            return false;
        }
      }
      function Dg(a) {
        return 0 !== (a.mode & 1) && 0 === (a.flags & 128);
      }
      function Eg(a) {
        if (I) {
          var b = yg;
          if (b) {
            var c = b;
            if (!Cg(a, b)) {
              if (Dg(a)) throw Error(p(418));
              b = Lf(c.nextSibling);
              var d = xg;
              b && Cg(a, b) ? Ag(d, c) : (a.flags = a.flags & -4097 | 2, I = false, xg = a);
            }
          } else {
            if (Dg(a)) throw Error(p(418));
            a.flags = a.flags & -4097 | 2;
            I = false;
            xg = a;
          }
        }
      }
      function Fg(a) {
        for (a = a.return; null !== a && 5 !== a.tag && 3 !== a.tag && 13 !== a.tag; ) a = a.return;
        xg = a;
      }
      function Gg(a) {
        if (a !== xg) return false;
        if (!I) return Fg(a), I = true, false;
        var b;
        (b = 3 !== a.tag) && !(b = 5 !== a.tag) && (b = a.type, b = "head" !== b && "body" !== b && !Ef(a.type, a.memoizedProps));
        if (b && (b = yg)) {
          if (Dg(a)) throw Hg(), Error(p(418));
          for (; b; ) Ag(a, b), b = Lf(b.nextSibling);
        }
        Fg(a);
        if (13 === a.tag) {
          a = a.memoizedState;
          a = null !== a ? a.dehydrated : null;
          if (!a) throw Error(p(317));
          a: {
            a = a.nextSibling;
            for (b = 0; a; ) {
              if (8 === a.nodeType) {
                var c = a.data;
                if ("/$" === c) {
                  if (0 === b) {
                    yg = Lf(a.nextSibling);
                    break a;
                  }
                  b--;
                } else "$" !== c && "$!" !== c && "$?" !== c || b++;
              }
              a = a.nextSibling;
            }
            yg = null;
          }
        } else yg = xg ? Lf(a.stateNode.nextSibling) : null;
        return true;
      }
      function Hg() {
        for (var a = yg; a; ) a = Lf(a.nextSibling);
      }
      function Ig() {
        yg = xg = null;
        I = false;
      }
      function Jg(a) {
        null === zg ? zg = [a] : zg.push(a);
      }
      var Kg = ua.ReactCurrentBatchConfig;
      function Lg(a, b, c) {
        a = c.ref;
        if (null !== a && "function" !== typeof a && "object" !== typeof a) {
          if (c._owner) {
            c = c._owner;
            if (c) {
              if (1 !== c.tag) throw Error(p(309));
              var d = c.stateNode;
            }
            if (!d) throw Error(p(147, a));
            var e = d, f = "" + a;
            if (null !== b && null !== b.ref && "function" === typeof b.ref && b.ref._stringRef === f) return b.ref;
            b = function(a2) {
              var b2 = e.refs;
              null === a2 ? delete b2[f] : b2[f] = a2;
            };
            b._stringRef = f;
            return b;
          }
          if ("string" !== typeof a) throw Error(p(284));
          if (!c._owner) throw Error(p(290, a));
        }
        return a;
      }
      function Mg(a, b) {
        a = Object.prototype.toString.call(b);
        throw Error(p(31, "[object Object]" === a ? "object with keys {" + Object.keys(b).join(", ") + "}" : a));
      }
      function Ng(a) {
        var b = a._init;
        return b(a._payload);
      }
      function Og(a) {
        function b(b2, c2) {
          if (a) {
            var d2 = b2.deletions;
            null === d2 ? (b2.deletions = [c2], b2.flags |= 16) : d2.push(c2);
          }
        }
        function c(c2, d2) {
          if (!a) return null;
          for (; null !== d2; ) b(c2, d2), d2 = d2.sibling;
          return null;
        }
        function d(a2, b2) {
          for (a2 = /* @__PURE__ */ new Map(); null !== b2; ) null !== b2.key ? a2.set(b2.key, b2) : a2.set(b2.index, b2), b2 = b2.sibling;
          return a2;
        }
        function e(a2, b2) {
          a2 = Pg(a2, b2);
          a2.index = 0;
          a2.sibling = null;
          return a2;
        }
        function f(b2, c2, d2) {
          b2.index = d2;
          if (!a) return b2.flags |= 1048576, c2;
          d2 = b2.alternate;
          if (null !== d2) return d2 = d2.index, d2 < c2 ? (b2.flags |= 2, c2) : d2;
          b2.flags |= 2;
          return c2;
        }
        function g(b2) {
          a && null === b2.alternate && (b2.flags |= 2);
          return b2;
        }
        function h(a2, b2, c2, d2) {
          if (null === b2 || 6 !== b2.tag) return b2 = Qg(c2, a2.mode, d2), b2.return = a2, b2;
          b2 = e(b2, c2);
          b2.return = a2;
          return b2;
        }
        function k(a2, b2, c2, d2) {
          var f2 = c2.type;
          if (f2 === ya) return m(a2, b2, c2.props.children, d2, c2.key);
          if (null !== b2 && (b2.elementType === f2 || "object" === typeof f2 && null !== f2 && f2.$$typeof === Ha && Ng(f2) === b2.type)) return d2 = e(b2, c2.props), d2.ref = Lg(a2, b2, c2), d2.return = a2, d2;
          d2 = Rg(c2.type, c2.key, c2.props, null, a2.mode, d2);
          d2.ref = Lg(a2, b2, c2);
          d2.return = a2;
          return d2;
        }
        function l(a2, b2, c2, d2) {
          if (null === b2 || 4 !== b2.tag || b2.stateNode.containerInfo !== c2.containerInfo || b2.stateNode.implementation !== c2.implementation) return b2 = Sg(c2, a2.mode, d2), b2.return = a2, b2;
          b2 = e(b2, c2.children || []);
          b2.return = a2;
          return b2;
        }
        function m(a2, b2, c2, d2, f2) {
          if (null === b2 || 7 !== b2.tag) return b2 = Tg(c2, a2.mode, d2, f2), b2.return = a2, b2;
          b2 = e(b2, c2);
          b2.return = a2;
          return b2;
        }
        function q(a2, b2, c2) {
          if ("string" === typeof b2 && "" !== b2 || "number" === typeof b2) return b2 = Qg("" + b2, a2.mode, c2), b2.return = a2, b2;
          if ("object" === typeof b2 && null !== b2) {
            switch (b2.$$typeof) {
              case va:
                return c2 = Rg(b2.type, b2.key, b2.props, null, a2.mode, c2), c2.ref = Lg(a2, null, b2), c2.return = a2, c2;
              case wa:
                return b2 = Sg(b2, a2.mode, c2), b2.return = a2, b2;
              case Ha:
                var d2 = b2._init;
                return q(a2, d2(b2._payload), c2);
            }
            if (eb(b2) || Ka(b2)) return b2 = Tg(b2, a2.mode, c2, null), b2.return = a2, b2;
            Mg(a2, b2);
          }
          return null;
        }
        function r(a2, b2, c2, d2) {
          var e2 = null !== b2 ? b2.key : null;
          if ("string" === typeof c2 && "" !== c2 || "number" === typeof c2) return null !== e2 ? null : h(a2, b2, "" + c2, d2);
          if ("object" === typeof c2 && null !== c2) {
            switch (c2.$$typeof) {
              case va:
                return c2.key === e2 ? k(a2, b2, c2, d2) : null;
              case wa:
                return c2.key === e2 ? l(a2, b2, c2, d2) : null;
              case Ha:
                return e2 = c2._init, r(
                  a2,
                  b2,
                  e2(c2._payload),
                  d2
                );
            }
            if (eb(c2) || Ka(c2)) return null !== e2 ? null : m(a2, b2, c2, d2, null);
            Mg(a2, c2);
          }
          return null;
        }
        function y(a2, b2, c2, d2, e2) {
          if ("string" === typeof d2 && "" !== d2 || "number" === typeof d2) return a2 = a2.get(c2) || null, h(b2, a2, "" + d2, e2);
          if ("object" === typeof d2 && null !== d2) {
            switch (d2.$$typeof) {
              case va:
                return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, k(b2, a2, d2, e2);
              case wa:
                return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, l(b2, a2, d2, e2);
              case Ha:
                var f2 = d2._init;
                return y(a2, b2, c2, f2(d2._payload), e2);
            }
            if (eb(d2) || Ka(d2)) return a2 = a2.get(c2) || null, m(b2, a2, d2, e2, null);
            Mg(b2, d2);
          }
          return null;
        }
        function n(e2, g2, h2, k2) {
          for (var l2 = null, m2 = null, u = g2, w = g2 = 0, x = null; null !== u && w < h2.length; w++) {
            u.index > w ? (x = u, u = null) : x = u.sibling;
            var n2 = r(e2, u, h2[w], k2);
            if (null === n2) {
              null === u && (u = x);
              break;
            }
            a && u && null === n2.alternate && b(e2, u);
            g2 = f(n2, g2, w);
            null === m2 ? l2 = n2 : m2.sibling = n2;
            m2 = n2;
            u = x;
          }
          if (w === h2.length) return c(e2, u), I && tg(e2, w), l2;
          if (null === u) {
            for (; w < h2.length; w++) u = q(e2, h2[w], k2), null !== u && (g2 = f(u, g2, w), null === m2 ? l2 = u : m2.sibling = u, m2 = u);
            I && tg(e2, w);
            return l2;
          }
          for (u = d(e2, u); w < h2.length; w++) x = y(u, e2, w, h2[w], k2), null !== x && (a && null !== x.alternate && u.delete(null === x.key ? w : x.key), g2 = f(x, g2, w), null === m2 ? l2 = x : m2.sibling = x, m2 = x);
          a && u.forEach(function(a2) {
            return b(e2, a2);
          });
          I && tg(e2, w);
          return l2;
        }
        function t3(e2, g2, h2, k2) {
          var l2 = Ka(h2);
          if ("function" !== typeof l2) throw Error(p(150));
          h2 = l2.call(h2);
          if (null == h2) throw Error(p(151));
          for (var u = l2 = null, m2 = g2, w = g2 = 0, x = null, n2 = h2.next(); null !== m2 && !n2.done; w++, n2 = h2.next()) {
            m2.index > w ? (x = m2, m2 = null) : x = m2.sibling;
            var t4 = r(e2, m2, n2.value, k2);
            if (null === t4) {
              null === m2 && (m2 = x);
              break;
            }
            a && m2 && null === t4.alternate && b(e2, m2);
            g2 = f(t4, g2, w);
            null === u ? l2 = t4 : u.sibling = t4;
            u = t4;
            m2 = x;
          }
          if (n2.done) return c(
            e2,
            m2
          ), I && tg(e2, w), l2;
          if (null === m2) {
            for (; !n2.done; w++, n2 = h2.next()) n2 = q(e2, n2.value, k2), null !== n2 && (g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
            I && tg(e2, w);
            return l2;
          }
          for (m2 = d(e2, m2); !n2.done; w++, n2 = h2.next()) n2 = y(m2, e2, w, n2.value, k2), null !== n2 && (a && null !== n2.alternate && m2.delete(null === n2.key ? w : n2.key), g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
          a && m2.forEach(function(a2) {
            return b(e2, a2);
          });
          I && tg(e2, w);
          return l2;
        }
        function J(a2, d2, f2, h2) {
          "object" === typeof f2 && null !== f2 && f2.type === ya && null === f2.key && (f2 = f2.props.children);
          if ("object" === typeof f2 && null !== f2) {
            switch (f2.$$typeof) {
              case va:
                a: {
                  for (var k2 = f2.key, l2 = d2; null !== l2; ) {
                    if (l2.key === k2) {
                      k2 = f2.type;
                      if (k2 === ya) {
                        if (7 === l2.tag) {
                          c(a2, l2.sibling);
                          d2 = e(l2, f2.props.children);
                          d2.return = a2;
                          a2 = d2;
                          break a;
                        }
                      } else if (l2.elementType === k2 || "object" === typeof k2 && null !== k2 && k2.$$typeof === Ha && Ng(k2) === l2.type) {
                        c(a2, l2.sibling);
                        d2 = e(l2, f2.props);
                        d2.ref = Lg(a2, l2, f2);
                        d2.return = a2;
                        a2 = d2;
                        break a;
                      }
                      c(a2, l2);
                      break;
                    } else b(a2, l2);
                    l2 = l2.sibling;
                  }
                  f2.type === ya ? (d2 = Tg(f2.props.children, a2.mode, h2, f2.key), d2.return = a2, a2 = d2) : (h2 = Rg(f2.type, f2.key, f2.props, null, a2.mode, h2), h2.ref = Lg(a2, d2, f2), h2.return = a2, a2 = h2);
                }
                return g(a2);
              case wa:
                a: {
                  for (l2 = f2.key; null !== d2; ) {
                    if (d2.key === l2) if (4 === d2.tag && d2.stateNode.containerInfo === f2.containerInfo && d2.stateNode.implementation === f2.implementation) {
                      c(a2, d2.sibling);
                      d2 = e(d2, f2.children || []);
                      d2.return = a2;
                      a2 = d2;
                      break a;
                    } else {
                      c(a2, d2);
                      break;
                    }
                    else b(a2, d2);
                    d2 = d2.sibling;
                  }
                  d2 = Sg(f2, a2.mode, h2);
                  d2.return = a2;
                  a2 = d2;
                }
                return g(a2);
              case Ha:
                return l2 = f2._init, J(a2, d2, l2(f2._payload), h2);
            }
            if (eb(f2)) return n(a2, d2, f2, h2);
            if (Ka(f2)) return t3(a2, d2, f2, h2);
            Mg(a2, f2);
          }
          return "string" === typeof f2 && "" !== f2 || "number" === typeof f2 ? (f2 = "" + f2, null !== d2 && 6 === d2.tag ? (c(a2, d2.sibling), d2 = e(d2, f2), d2.return = a2, a2 = d2) : (c(a2, d2), d2 = Qg(f2, a2.mode, h2), d2.return = a2, a2 = d2), g(a2)) : c(a2, d2);
        }
        return J;
      }
      var Ug = Og(true);
      var Vg = Og(false);
      var Wg = Uf(null);
      var Xg = null;
      var Yg = null;
      var Zg = null;
      function $g() {
        Zg = Yg = Xg = null;
      }
      function ah(a) {
        var b = Wg.current;
        E(Wg);
        a._currentValue = b;
      }
      function bh(a, b, c) {
        for (; null !== a; ) {
          var d = a.alternate;
          (a.childLanes & b) !== b ? (a.childLanes |= b, null !== d && (d.childLanes |= b)) : null !== d && (d.childLanes & b) !== b && (d.childLanes |= b);
          if (a === c) break;
          a = a.return;
        }
      }
      function ch(a, b) {
        Xg = a;
        Zg = Yg = null;
        a = a.dependencies;
        null !== a && null !== a.firstContext && (0 !== (a.lanes & b) && (dh = true), a.firstContext = null);
      }
      function eh(a) {
        var b = a._currentValue;
        if (Zg !== a) if (a = { context: a, memoizedValue: b, next: null }, null === Yg) {
          if (null === Xg) throw Error(p(308));
          Yg = a;
          Xg.dependencies = { lanes: 0, firstContext: a };
        } else Yg = Yg.next = a;
        return b;
      }
      var fh = null;
      function gh(a) {
        null === fh ? fh = [a] : fh.push(a);
      }
      function hh(a, b, c, d) {
        var e = b.interleaved;
        null === e ? (c.next = c, gh(b)) : (c.next = e.next, e.next = c);
        b.interleaved = c;
        return ih(a, d);
      }
      function ih(a, b) {
        a.lanes |= b;
        var c = a.alternate;
        null !== c && (c.lanes |= b);
        c = a;
        for (a = a.return; null !== a; ) a.childLanes |= b, c = a.alternate, null !== c && (c.childLanes |= b), c = a, a = a.return;
        return 3 === c.tag ? c.stateNode : null;
      }
      var jh = false;
      function kh(a) {
        a.updateQueue = { baseState: a.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
      }
      function lh(a, b) {
        a = a.updateQueue;
        b.updateQueue === a && (b.updateQueue = { baseState: a.baseState, firstBaseUpdate: a.firstBaseUpdate, lastBaseUpdate: a.lastBaseUpdate, shared: a.shared, effects: a.effects });
      }
      function mh(a, b) {
        return { eventTime: a, lane: b, tag: 0, payload: null, callback: null, next: null };
      }
      function nh(a, b, c) {
        var d = a.updateQueue;
        if (null === d) return null;
        d = d.shared;
        if (0 !== (K & 2)) {
          var e = d.pending;
          null === e ? b.next = b : (b.next = e.next, e.next = b);
          d.pending = b;
          return ih(a, c);
        }
        e = d.interleaved;
        null === e ? (b.next = b, gh(d)) : (b.next = e.next, e.next = b);
        d.interleaved = b;
        return ih(a, c);
      }
      function oh(a, b, c) {
        b = b.updateQueue;
        if (null !== b && (b = b.shared, 0 !== (c & 4194240))) {
          var d = b.lanes;
          d &= a.pendingLanes;
          c |= d;
          b.lanes = c;
          Cc(a, c);
        }
      }
      function ph(a, b) {
        var c = a.updateQueue, d = a.alternate;
        if (null !== d && (d = d.updateQueue, c === d)) {
          var e = null, f = null;
          c = c.firstBaseUpdate;
          if (null !== c) {
            do {
              var g = { eventTime: c.eventTime, lane: c.lane, tag: c.tag, payload: c.payload, callback: c.callback, next: null };
              null === f ? e = f = g : f = f.next = g;
              c = c.next;
            } while (null !== c);
            null === f ? e = f = b : f = f.next = b;
          } else e = f = b;
          c = { baseState: d.baseState, firstBaseUpdate: e, lastBaseUpdate: f, shared: d.shared, effects: d.effects };
          a.updateQueue = c;
          return;
        }
        a = c.lastBaseUpdate;
        null === a ? c.firstBaseUpdate = b : a.next = b;
        c.lastBaseUpdate = b;
      }
      function qh(a, b, c, d) {
        var e = a.updateQueue;
        jh = false;
        var f = e.firstBaseUpdate, g = e.lastBaseUpdate, h = e.shared.pending;
        if (null !== h) {
          e.shared.pending = null;
          var k = h, l = k.next;
          k.next = null;
          null === g ? f = l : g.next = l;
          g = k;
          var m = a.alternate;
          null !== m && (m = m.updateQueue, h = m.lastBaseUpdate, h !== g && (null === h ? m.firstBaseUpdate = l : h.next = l, m.lastBaseUpdate = k));
        }
        if (null !== f) {
          var q = e.baseState;
          g = 0;
          m = l = k = null;
          h = f;
          do {
            var r = h.lane, y = h.eventTime;
            if ((d & r) === r) {
              null !== m && (m = m.next = {
                eventTime: y,
                lane: 0,
                tag: h.tag,
                payload: h.payload,
                callback: h.callback,
                next: null
              });
              a: {
                var n = a, t3 = h;
                r = b;
                y = c;
                switch (t3.tag) {
                  case 1:
                    n = t3.payload;
                    if ("function" === typeof n) {
                      q = n.call(y, q, r);
                      break a;
                    }
                    q = n;
                    break a;
                  case 3:
                    n.flags = n.flags & -65537 | 128;
                  case 0:
                    n = t3.payload;
                    r = "function" === typeof n ? n.call(y, q, r) : n;
                    if (null === r || void 0 === r) break a;
                    q = A({}, q, r);
                    break a;
                  case 2:
                    jh = true;
                }
              }
              null !== h.callback && 0 !== h.lane && (a.flags |= 64, r = e.effects, null === r ? e.effects = [h] : r.push(h));
            } else y = { eventTime: y, lane: r, tag: h.tag, payload: h.payload, callback: h.callback, next: null }, null === m ? (l = m = y, k = q) : m = m.next = y, g |= r;
            h = h.next;
            if (null === h) if (h = e.shared.pending, null === h) break;
            else r = h, h = r.next, r.next = null, e.lastBaseUpdate = r, e.shared.pending = null;
          } while (1);
          null === m && (k = q);
          e.baseState = k;
          e.firstBaseUpdate = l;
          e.lastBaseUpdate = m;
          b = e.shared.interleaved;
          if (null !== b) {
            e = b;
            do
              g |= e.lane, e = e.next;
            while (e !== b);
          } else null === f && (e.shared.lanes = 0);
          rh |= g;
          a.lanes = g;
          a.memoizedState = q;
        }
      }
      function sh(a, b, c) {
        a = b.effects;
        b.effects = null;
        if (null !== a) for (b = 0; b < a.length; b++) {
          var d = a[b], e = d.callback;
          if (null !== e) {
            d.callback = null;
            d = c;
            if ("function" !== typeof e) throw Error(p(191, e));
            e.call(d);
          }
        }
      }
      var th = {};
      var uh = Uf(th);
      var vh = Uf(th);
      var wh = Uf(th);
      function xh(a) {
        if (a === th) throw Error(p(174));
        return a;
      }
      function yh(a, b) {
        G(wh, b);
        G(vh, a);
        G(uh, th);
        a = b.nodeType;
        switch (a) {
          case 9:
          case 11:
            b = (b = b.documentElement) ? b.namespaceURI : lb(null, "");
            break;
          default:
            a = 8 === a ? b.parentNode : b, b = a.namespaceURI || null, a = a.tagName, b = lb(b, a);
        }
        E(uh);
        G(uh, b);
      }
      function zh() {
        E(uh);
        E(vh);
        E(wh);
      }
      function Ah(a) {
        xh(wh.current);
        var b = xh(uh.current);
        var c = lb(b, a.type);
        b !== c && (G(vh, a), G(uh, c));
      }
      function Bh(a) {
        vh.current === a && (E(uh), E(vh));
      }
      var L = Uf(0);
      function Ch(a) {
        for (var b = a; null !== b; ) {
          if (13 === b.tag) {
            var c = b.memoizedState;
            if (null !== c && (c = c.dehydrated, null === c || "$?" === c.data || "$!" === c.data)) return b;
          } else if (19 === b.tag && void 0 !== b.memoizedProps.revealOrder) {
            if (0 !== (b.flags & 128)) return b;
          } else if (null !== b.child) {
            b.child.return = b;
            b = b.child;
            continue;
          }
          if (b === a) break;
          for (; null === b.sibling; ) {
            if (null === b.return || b.return === a) return null;
            b = b.return;
          }
          b.sibling.return = b.return;
          b = b.sibling;
        }
        return null;
      }
      var Dh = [];
      function Eh() {
        for (var a = 0; a < Dh.length; a++) Dh[a]._workInProgressVersionPrimary = null;
        Dh.length = 0;
      }
      var Fh = ua.ReactCurrentDispatcher;
      var Gh = ua.ReactCurrentBatchConfig;
      var Hh = 0;
      var M = null;
      var N = null;
      var O = null;
      var Ih = false;
      var Jh = false;
      var Kh = 0;
      var Lh = 0;
      function P() {
        throw Error(p(321));
      }
      function Mh(a, b) {
        if (null === b) return false;
        for (var c = 0; c < b.length && c < a.length; c++) if (!He(a[c], b[c])) return false;
        return true;
      }
      function Nh(a, b, c, d, e, f) {
        Hh = f;
        M = b;
        b.memoizedState = null;
        b.updateQueue = null;
        b.lanes = 0;
        Fh.current = null === a || null === a.memoizedState ? Oh : Ph;
        a = c(d, e);
        if (Jh) {
          f = 0;
          do {
            Jh = false;
            Kh = 0;
            if (25 <= f) throw Error(p(301));
            f += 1;
            O = N = null;
            b.updateQueue = null;
            Fh.current = Qh;
            a = c(d, e);
          } while (Jh);
        }
        Fh.current = Rh;
        b = null !== N && null !== N.next;
        Hh = 0;
        O = N = M = null;
        Ih = false;
        if (b) throw Error(p(300));
        return a;
      }
      function Sh() {
        var a = 0 !== Kh;
        Kh = 0;
        return a;
      }
      function Th() {
        var a = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
        null === O ? M.memoizedState = O = a : O = O.next = a;
        return O;
      }
      function Uh() {
        if (null === N) {
          var a = M.alternate;
          a = null !== a ? a.memoizedState : null;
        } else a = N.next;
        var b = null === O ? M.memoizedState : O.next;
        if (null !== b) O = b, N = a;
        else {
          if (null === a) throw Error(p(310));
          N = a;
          a = { memoizedState: N.memoizedState, baseState: N.baseState, baseQueue: N.baseQueue, queue: N.queue, next: null };
          null === O ? M.memoizedState = O = a : O = O.next = a;
        }
        return O;
      }
      function Vh(a, b) {
        return "function" === typeof b ? b(a) : b;
      }
      function Wh(a) {
        var b = Uh(), c = b.queue;
        if (null === c) throw Error(p(311));
        c.lastRenderedReducer = a;
        var d = N, e = d.baseQueue, f = c.pending;
        if (null !== f) {
          if (null !== e) {
            var g = e.next;
            e.next = f.next;
            f.next = g;
          }
          d.baseQueue = e = f;
          c.pending = null;
        }
        if (null !== e) {
          f = e.next;
          d = d.baseState;
          var h = g = null, k = null, l = f;
          do {
            var m = l.lane;
            if ((Hh & m) === m) null !== k && (k = k.next = { lane: 0, action: l.action, hasEagerState: l.hasEagerState, eagerState: l.eagerState, next: null }), d = l.hasEagerState ? l.eagerState : a(d, l.action);
            else {
              var q = {
                lane: m,
                action: l.action,
                hasEagerState: l.hasEagerState,
                eagerState: l.eagerState,
                next: null
              };
              null === k ? (h = k = q, g = d) : k = k.next = q;
              M.lanes |= m;
              rh |= m;
            }
            l = l.next;
          } while (null !== l && l !== f);
          null === k ? g = d : k.next = h;
          He(d, b.memoizedState) || (dh = true);
          b.memoizedState = d;
          b.baseState = g;
          b.baseQueue = k;
          c.lastRenderedState = d;
        }
        a = c.interleaved;
        if (null !== a) {
          e = a;
          do
            f = e.lane, M.lanes |= f, rh |= f, e = e.next;
          while (e !== a);
        } else null === e && (c.lanes = 0);
        return [b.memoizedState, c.dispatch];
      }
      function Xh(a) {
        var b = Uh(), c = b.queue;
        if (null === c) throw Error(p(311));
        c.lastRenderedReducer = a;
        var d = c.dispatch, e = c.pending, f = b.memoizedState;
        if (null !== e) {
          c.pending = null;
          var g = e = e.next;
          do
            f = a(f, g.action), g = g.next;
          while (g !== e);
          He(f, b.memoizedState) || (dh = true);
          b.memoizedState = f;
          null === b.baseQueue && (b.baseState = f);
          c.lastRenderedState = f;
        }
        return [f, d];
      }
      function Yh() {
      }
      function Zh(a, b) {
        var c = M, d = Uh(), e = b(), f = !He(d.memoizedState, e);
        f && (d.memoizedState = e, dh = true);
        d = d.queue;
        $h(ai.bind(null, c, d, a), [a]);
        if (d.getSnapshot !== b || f || null !== O && O.memoizedState.tag & 1) {
          c.flags |= 2048;
          bi(9, ci.bind(null, c, d, e, b), void 0, null);
          if (null === Q) throw Error(p(349));
          0 !== (Hh & 30) || di(c, b, e);
        }
        return e;
      }
      function di(a, b, c) {
        a.flags |= 16384;
        a = { getSnapshot: b, value: c };
        b = M.updateQueue;
        null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.stores = [a]) : (c = b.stores, null === c ? b.stores = [a] : c.push(a));
      }
      function ci(a, b, c, d) {
        b.value = c;
        b.getSnapshot = d;
        ei(b) && fi(a);
      }
      function ai(a, b, c) {
        return c(function() {
          ei(b) && fi(a);
        });
      }
      function ei(a) {
        var b = a.getSnapshot;
        a = a.value;
        try {
          var c = b();
          return !He(a, c);
        } catch (d) {
          return true;
        }
      }
      function fi(a) {
        var b = ih(a, 1);
        null !== b && gi(b, a, 1, -1);
      }
      function hi(a) {
        var b = Th();
        "function" === typeof a && (a = a());
        b.memoizedState = b.baseState = a;
        a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Vh, lastRenderedState: a };
        b.queue = a;
        a = a.dispatch = ii.bind(null, M, a);
        return [b.memoizedState, a];
      }
      function bi(a, b, c, d) {
        a = { tag: a, create: b, destroy: c, deps: d, next: null };
        b = M.updateQueue;
        null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.lastEffect = a.next = a) : (c = b.lastEffect, null === c ? b.lastEffect = a.next = a : (d = c.next, c.next = a, a.next = d, b.lastEffect = a));
        return a;
      }
      function ji() {
        return Uh().memoizedState;
      }
      function ki(a, b, c, d) {
        var e = Th();
        M.flags |= a;
        e.memoizedState = bi(1 | b, c, void 0, void 0 === d ? null : d);
      }
      function li(a, b, c, d) {
        var e = Uh();
        d = void 0 === d ? null : d;
        var f = void 0;
        if (null !== N) {
          var g = N.memoizedState;
          f = g.destroy;
          if (null !== d && Mh(d, g.deps)) {
            e.memoizedState = bi(b, c, f, d);
            return;
          }
        }
        M.flags |= a;
        e.memoizedState = bi(1 | b, c, f, d);
      }
      function mi(a, b) {
        return ki(8390656, 8, a, b);
      }
      function $h(a, b) {
        return li(2048, 8, a, b);
      }
      function ni(a, b) {
        return li(4, 2, a, b);
      }
      function oi(a, b) {
        return li(4, 4, a, b);
      }
      function pi(a, b) {
        if ("function" === typeof b) return a = a(), b(a), function() {
          b(null);
        };
        if (null !== b && void 0 !== b) return a = a(), b.current = a, function() {
          b.current = null;
        };
      }
      function qi(a, b, c) {
        c = null !== c && void 0 !== c ? c.concat([a]) : null;
        return li(4, 4, pi.bind(null, b, a), c);
      }
      function ri() {
      }
      function si(a, b) {
        var c = Uh();
        b = void 0 === b ? null : b;
        var d = c.memoizedState;
        if (null !== d && null !== b && Mh(b, d[1])) return d[0];
        c.memoizedState = [a, b];
        return a;
      }
      function ti(a, b) {
        var c = Uh();
        b = void 0 === b ? null : b;
        var d = c.memoizedState;
        if (null !== d && null !== b && Mh(b, d[1])) return d[0];
        a = a();
        c.memoizedState = [a, b];
        return a;
      }
      function ui(a, b, c) {
        if (0 === (Hh & 21)) return a.baseState && (a.baseState = false, dh = true), a.memoizedState = c;
        He(c, b) || (c = yc(), M.lanes |= c, rh |= c, a.baseState = true);
        return b;
      }
      function vi(a, b) {
        var c = C;
        C = 0 !== c && 4 > c ? c : 4;
        a(true);
        var d = Gh.transition;
        Gh.transition = {};
        try {
          a(false), b();
        } finally {
          C = c, Gh.transition = d;
        }
      }
      function wi() {
        return Uh().memoizedState;
      }
      function xi(a, b, c) {
        var d = yi(a);
        c = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
        if (zi(a)) Ai(b, c);
        else if (c = hh(a, b, c, d), null !== c) {
          var e = R();
          gi(c, a, d, e);
          Bi(c, b, d);
        }
      }
      function ii(a, b, c) {
        var d = yi(a), e = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
        if (zi(a)) Ai(b, e);
        else {
          var f = a.alternate;
          if (0 === a.lanes && (null === f || 0 === f.lanes) && (f = b.lastRenderedReducer, null !== f)) try {
            var g = b.lastRenderedState, h = f(g, c);
            e.hasEagerState = true;
            e.eagerState = h;
            if (He(h, g)) {
              var k = b.interleaved;
              null === k ? (e.next = e, gh(b)) : (e.next = k.next, k.next = e);
              b.interleaved = e;
              return;
            }
          } catch (l) {
          } finally {
          }
          c = hh(a, b, e, d);
          null !== c && (e = R(), gi(c, a, d, e), Bi(c, b, d));
        }
      }
      function zi(a) {
        var b = a.alternate;
        return a === M || null !== b && b === M;
      }
      function Ai(a, b) {
        Jh = Ih = true;
        var c = a.pending;
        null === c ? b.next = b : (b.next = c.next, c.next = b);
        a.pending = b;
      }
      function Bi(a, b, c) {
        if (0 !== (c & 4194240)) {
          var d = b.lanes;
          d &= a.pendingLanes;
          c |= d;
          b.lanes = c;
          Cc(a, c);
        }
      }
      var Rh = { readContext: eh, useCallback: P, useContext: P, useEffect: P, useImperativeHandle: P, useInsertionEffect: P, useLayoutEffect: P, useMemo: P, useReducer: P, useRef: P, useState: P, useDebugValue: P, useDeferredValue: P, useTransition: P, useMutableSource: P, useSyncExternalStore: P, useId: P, unstable_isNewReconciler: false };
      var Oh = { readContext: eh, useCallback: function(a, b) {
        Th().memoizedState = [a, void 0 === b ? null : b];
        return a;
      }, useContext: eh, useEffect: mi, useImperativeHandle: function(a, b, c) {
        c = null !== c && void 0 !== c ? c.concat([a]) : null;
        return ki(
          4194308,
          4,
          pi.bind(null, b, a),
          c
        );
      }, useLayoutEffect: function(a, b) {
        return ki(4194308, 4, a, b);
      }, useInsertionEffect: function(a, b) {
        return ki(4, 2, a, b);
      }, useMemo: function(a, b) {
        var c = Th();
        b = void 0 === b ? null : b;
        a = a();
        c.memoizedState = [a, b];
        return a;
      }, useReducer: function(a, b, c) {
        var d = Th();
        b = void 0 !== c ? c(b) : b;
        d.memoizedState = d.baseState = b;
        a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: a, lastRenderedState: b };
        d.queue = a;
        a = a.dispatch = xi.bind(null, M, a);
        return [d.memoizedState, a];
      }, useRef: function(a) {
        var b = Th();
        a = { current: a };
        return b.memoizedState = a;
      }, useState: hi, useDebugValue: ri, useDeferredValue: function(a) {
        return Th().memoizedState = a;
      }, useTransition: function() {
        var a = hi(false), b = a[0];
        a = vi.bind(null, a[1]);
        Th().memoizedState = a;
        return [b, a];
      }, useMutableSource: function() {
      }, useSyncExternalStore: function(a, b, c) {
        var d = M, e = Th();
        if (I) {
          if (void 0 === c) throw Error(p(407));
          c = c();
        } else {
          c = b();
          if (null === Q) throw Error(p(349));
          0 !== (Hh & 30) || di(d, b, c);
        }
        e.memoizedState = c;
        var f = { value: c, getSnapshot: b };
        e.queue = f;
        mi(ai.bind(
          null,
          d,
          f,
          a
        ), [a]);
        d.flags |= 2048;
        bi(9, ci.bind(null, d, f, c, b), void 0, null);
        return c;
      }, useId: function() {
        var a = Th(), b = Q.identifierPrefix;
        if (I) {
          var c = sg;
          var d = rg;
          c = (d & ~(1 << 32 - oc(d) - 1)).toString(32) + c;
          b = ":" + b + "R" + c;
          c = Kh++;
          0 < c && (b += "H" + c.toString(32));
          b += ":";
        } else c = Lh++, b = ":" + b + "r" + c.toString(32) + ":";
        return a.memoizedState = b;
      }, unstable_isNewReconciler: false };
      var Ph = {
        readContext: eh,
        useCallback: si,
        useContext: eh,
        useEffect: $h,
        useImperativeHandle: qi,
        useInsertionEffect: ni,
        useLayoutEffect: oi,
        useMemo: ti,
        useReducer: Wh,
        useRef: ji,
        useState: function() {
          return Wh(Vh);
        },
        useDebugValue: ri,
        useDeferredValue: function(a) {
          var b = Uh();
          return ui(b, N.memoizedState, a);
        },
        useTransition: function() {
          var a = Wh(Vh)[0], b = Uh().memoizedState;
          return [a, b];
        },
        useMutableSource: Yh,
        useSyncExternalStore: Zh,
        useId: wi,
        unstable_isNewReconciler: false
      };
      var Qh = { readContext: eh, useCallback: si, useContext: eh, useEffect: $h, useImperativeHandle: qi, useInsertionEffect: ni, useLayoutEffect: oi, useMemo: ti, useReducer: Xh, useRef: ji, useState: function() {
        return Xh(Vh);
      }, useDebugValue: ri, useDeferredValue: function(a) {
        var b = Uh();
        return null === N ? b.memoizedState = a : ui(b, N.memoizedState, a);
      }, useTransition: function() {
        var a = Xh(Vh)[0], b = Uh().memoizedState;
        return [a, b];
      }, useMutableSource: Yh, useSyncExternalStore: Zh, useId: wi, unstable_isNewReconciler: false };
      function Ci(a, b) {
        if (a && a.defaultProps) {
          b = A({}, b);
          a = a.defaultProps;
          for (var c in a) void 0 === b[c] && (b[c] = a[c]);
          return b;
        }
        return b;
      }
      function Di(a, b, c, d) {
        b = a.memoizedState;
        c = c(d, b);
        c = null === c || void 0 === c ? b : A({}, b, c);
        a.memoizedState = c;
        0 === a.lanes && (a.updateQueue.baseState = c);
      }
      var Ei = { isMounted: function(a) {
        return (a = a._reactInternals) ? Vb(a) === a : false;
      }, enqueueSetState: function(a, b, c) {
        a = a._reactInternals;
        var d = R(), e = yi(a), f = mh(d, e);
        f.payload = b;
        void 0 !== c && null !== c && (f.callback = c);
        b = nh(a, f, e);
        null !== b && (gi(b, a, e, d), oh(b, a, e));
      }, enqueueReplaceState: function(a, b, c) {
        a = a._reactInternals;
        var d = R(), e = yi(a), f = mh(d, e);
        f.tag = 1;
        f.payload = b;
        void 0 !== c && null !== c && (f.callback = c);
        b = nh(a, f, e);
        null !== b && (gi(b, a, e, d), oh(b, a, e));
      }, enqueueForceUpdate: function(a, b) {
        a = a._reactInternals;
        var c = R(), d = yi(a), e = mh(c, d);
        e.tag = 2;
        void 0 !== b && null !== b && (e.callback = b);
        b = nh(a, e, d);
        null !== b && (gi(b, a, d, c), oh(b, a, d));
      } };
      function Fi(a, b, c, d, e, f, g) {
        a = a.stateNode;
        return "function" === typeof a.shouldComponentUpdate ? a.shouldComponentUpdate(d, f, g) : b.prototype && b.prototype.isPureReactComponent ? !Ie(c, d) || !Ie(e, f) : true;
      }
      function Gi(a, b, c) {
        var d = false, e = Vf;
        var f = b.contextType;
        "object" === typeof f && null !== f ? f = eh(f) : (e = Zf(b) ? Xf : H.current, d = b.contextTypes, f = (d = null !== d && void 0 !== d) ? Yf(a, e) : Vf);
        b = new b(c, f);
        a.memoizedState = null !== b.state && void 0 !== b.state ? b.state : null;
        b.updater = Ei;
        a.stateNode = b;
        b._reactInternals = a;
        d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = e, a.__reactInternalMemoizedMaskedChildContext = f);
        return b;
      }
      function Hi(a, b, c, d) {
        a = b.state;
        "function" === typeof b.componentWillReceiveProps && b.componentWillReceiveProps(c, d);
        "function" === typeof b.UNSAFE_componentWillReceiveProps && b.UNSAFE_componentWillReceiveProps(c, d);
        b.state !== a && Ei.enqueueReplaceState(b, b.state, null);
      }
      function Ii(a, b, c, d) {
        var e = a.stateNode;
        e.props = c;
        e.state = a.memoizedState;
        e.refs = {};
        kh(a);
        var f = b.contextType;
        "object" === typeof f && null !== f ? e.context = eh(f) : (f = Zf(b) ? Xf : H.current, e.context = Yf(a, f));
        e.state = a.memoizedState;
        f = b.getDerivedStateFromProps;
        "function" === typeof f && (Di(a, b, f, c), e.state = a.memoizedState);
        "function" === typeof b.getDerivedStateFromProps || "function" === typeof e.getSnapshotBeforeUpdate || "function" !== typeof e.UNSAFE_componentWillMount && "function" !== typeof e.componentWillMount || (b = e.state, "function" === typeof e.componentWillMount && e.componentWillMount(), "function" === typeof e.UNSAFE_componentWillMount && e.UNSAFE_componentWillMount(), b !== e.state && Ei.enqueueReplaceState(e, e.state, null), qh(a, c, e, d), e.state = a.memoizedState);
        "function" === typeof e.componentDidMount && (a.flags |= 4194308);
      }
      function Ji(a, b) {
        try {
          var c = "", d = b;
          do
            c += Pa(d), d = d.return;
          while (d);
          var e = c;
        } catch (f) {
          e = "\nError generating stack: " + f.message + "\n" + f.stack;
        }
        return { value: a, source: b, stack: e, digest: null };
      }
      function Ki(a, b, c) {
        return { value: a, source: null, stack: null != c ? c : null, digest: null != b ? b : null };
      }
      function Li(a, b) {
        try {
          console.error(b.value);
        } catch (c) {
          setTimeout(function() {
            throw c;
          });
        }
      }
      var Mi = "function" === typeof WeakMap ? WeakMap : Map;
      function Ni(a, b, c) {
        c = mh(-1, c);
        c.tag = 3;
        c.payload = { element: null };
        var d = b.value;
        c.callback = function() {
          Oi || (Oi = true, Pi = d);
          Li(a, b);
        };
        return c;
      }
      function Qi(a, b, c) {
        c = mh(-1, c);
        c.tag = 3;
        var d = a.type.getDerivedStateFromError;
        if ("function" === typeof d) {
          var e = b.value;
          c.payload = function() {
            return d(e);
          };
          c.callback = function() {
            Li(a, b);
          };
        }
        var f = a.stateNode;
        null !== f && "function" === typeof f.componentDidCatch && (c.callback = function() {
          Li(a, b);
          "function" !== typeof d && (null === Ri ? Ri = /* @__PURE__ */ new Set([this]) : Ri.add(this));
          var c2 = b.stack;
          this.componentDidCatch(b.value, { componentStack: null !== c2 ? c2 : "" });
        });
        return c;
      }
      function Si(a, b, c) {
        var d = a.pingCache;
        if (null === d) {
          d = a.pingCache = new Mi();
          var e = /* @__PURE__ */ new Set();
          d.set(b, e);
        } else e = d.get(b), void 0 === e && (e = /* @__PURE__ */ new Set(), d.set(b, e));
        e.has(c) || (e.add(c), a = Ti.bind(null, a, b, c), b.then(a, a));
      }
      function Ui(a) {
        do {
          var b;
          if (b = 13 === a.tag) b = a.memoizedState, b = null !== b ? null !== b.dehydrated ? true : false : true;
          if (b) return a;
          a = a.return;
        } while (null !== a);
        return null;
      }
      function Vi(a, b, c, d, e) {
        if (0 === (a.mode & 1)) return a === b ? a.flags |= 65536 : (a.flags |= 128, c.flags |= 131072, c.flags &= -52805, 1 === c.tag && (null === c.alternate ? c.tag = 17 : (b = mh(-1, 1), b.tag = 2, nh(c, b, 1))), c.lanes |= 1), a;
        a.flags |= 65536;
        a.lanes = e;
        return a;
      }
      var Wi = ua.ReactCurrentOwner;
      var dh = false;
      function Xi(a, b, c, d) {
        b.child = null === a ? Vg(b, null, c, d) : Ug(b, a.child, c, d);
      }
      function Yi(a, b, c, d, e) {
        c = c.render;
        var f = b.ref;
        ch(b, e);
        d = Nh(a, b, c, d, f, e);
        c = Sh();
        if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
        I && c && vg(b);
        b.flags |= 1;
        Xi(a, b, d, e);
        return b.child;
      }
      function $i(a, b, c, d, e) {
        if (null === a) {
          var f = c.type;
          if ("function" === typeof f && !aj(f) && void 0 === f.defaultProps && null === c.compare && void 0 === c.defaultProps) return b.tag = 15, b.type = f, bj(a, b, f, d, e);
          a = Rg(c.type, null, d, b, b.mode, e);
          a.ref = b.ref;
          a.return = b;
          return b.child = a;
        }
        f = a.child;
        if (0 === (a.lanes & e)) {
          var g = f.memoizedProps;
          c = c.compare;
          c = null !== c ? c : Ie;
          if (c(g, d) && a.ref === b.ref) return Zi(a, b, e);
        }
        b.flags |= 1;
        a = Pg(f, d);
        a.ref = b.ref;
        a.return = b;
        return b.child = a;
      }
      function bj(a, b, c, d, e) {
        if (null !== a) {
          var f = a.memoizedProps;
          if (Ie(f, d) && a.ref === b.ref) if (dh = false, b.pendingProps = d = f, 0 !== (a.lanes & e)) 0 !== (a.flags & 131072) && (dh = true);
          else return b.lanes = a.lanes, Zi(a, b, e);
        }
        return cj(a, b, c, d, e);
      }
      function dj(a, b, c) {
        var d = b.pendingProps, e = d.children, f = null !== a ? a.memoizedState : null;
        if ("hidden" === d.mode) if (0 === (b.mode & 1)) b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, G(ej, fj), fj |= c;
        else {
          if (0 === (c & 1073741824)) return a = null !== f ? f.baseLanes | c : c, b.lanes = b.childLanes = 1073741824, b.memoizedState = { baseLanes: a, cachePool: null, transitions: null }, b.updateQueue = null, G(ej, fj), fj |= a, null;
          b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null };
          d = null !== f ? f.baseLanes : c;
          G(ej, fj);
          fj |= d;
        }
        else null !== f ? (d = f.baseLanes | c, b.memoizedState = null) : d = c, G(ej, fj), fj |= d;
        Xi(a, b, e, c);
        return b.child;
      }
      function gj(a, b) {
        var c = b.ref;
        if (null === a && null !== c || null !== a && a.ref !== c) b.flags |= 512, b.flags |= 2097152;
      }
      function cj(a, b, c, d, e) {
        var f = Zf(c) ? Xf : H.current;
        f = Yf(b, f);
        ch(b, e);
        c = Nh(a, b, c, d, f, e);
        d = Sh();
        if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
        I && d && vg(b);
        b.flags |= 1;
        Xi(a, b, c, e);
        return b.child;
      }
      function hj(a, b, c, d, e) {
        if (Zf(c)) {
          var f = true;
          cg(b);
        } else f = false;
        ch(b, e);
        if (null === b.stateNode) ij(a, b), Gi(b, c, d), Ii(b, c, d, e), d = true;
        else if (null === a) {
          var g = b.stateNode, h = b.memoizedProps;
          g.props = h;
          var k = g.context, l = c.contextType;
          "object" === typeof l && null !== l ? l = eh(l) : (l = Zf(c) ? Xf : H.current, l = Yf(b, l));
          var m = c.getDerivedStateFromProps, q = "function" === typeof m || "function" === typeof g.getSnapshotBeforeUpdate;
          q || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== d || k !== l) && Hi(b, g, d, l);
          jh = false;
          var r = b.memoizedState;
          g.state = r;
          qh(b, d, g, e);
          k = b.memoizedState;
          h !== d || r !== k || Wf.current || jh ? ("function" === typeof m && (Di(b, c, m, d), k = b.memoizedState), (h = jh || Fi(b, c, h, d, r, k, l)) ? (q || "function" !== typeof g.UNSAFE_componentWillMount && "function" !== typeof g.componentWillMount || ("function" === typeof g.componentWillMount && g.componentWillMount(), "function" === typeof g.UNSAFE_componentWillMount && g.UNSAFE_componentWillMount()), "function" === typeof g.componentDidMount && (b.flags |= 4194308)) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), b.memoizedProps = d, b.memoizedState = k), g.props = d, g.state = k, g.context = l, d = h) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), d = false);
        } else {
          g = b.stateNode;
          lh(a, b);
          h = b.memoizedProps;
          l = b.type === b.elementType ? h : Ci(b.type, h);
          g.props = l;
          q = b.pendingProps;
          r = g.context;
          k = c.contextType;
          "object" === typeof k && null !== k ? k = eh(k) : (k = Zf(c) ? Xf : H.current, k = Yf(b, k));
          var y = c.getDerivedStateFromProps;
          (m = "function" === typeof y || "function" === typeof g.getSnapshotBeforeUpdate) || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== q || r !== k) && Hi(b, g, d, k);
          jh = false;
          r = b.memoizedState;
          g.state = r;
          qh(b, d, g, e);
          var n = b.memoizedState;
          h !== q || r !== n || Wf.current || jh ? ("function" === typeof y && (Di(b, c, y, d), n = b.memoizedState), (l = jh || Fi(b, c, l, d, r, n, k) || false) ? (m || "function" !== typeof g.UNSAFE_componentWillUpdate && "function" !== typeof g.componentWillUpdate || ("function" === typeof g.componentWillUpdate && g.componentWillUpdate(d, n, k), "function" === typeof g.UNSAFE_componentWillUpdate && g.UNSAFE_componentWillUpdate(d, n, k)), "function" === typeof g.componentDidUpdate && (b.flags |= 4), "function" === typeof g.getSnapshotBeforeUpdate && (b.flags |= 1024)) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), b.memoizedProps = d, b.memoizedState = n), g.props = d, g.state = n, g.context = k, d = l) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), d = false);
        }
        return jj(a, b, c, d, f, e);
      }
      function jj(a, b, c, d, e, f) {
        gj(a, b);
        var g = 0 !== (b.flags & 128);
        if (!d && !g) return e && dg(b, c, false), Zi(a, b, f);
        d = b.stateNode;
        Wi.current = b;
        var h = g && "function" !== typeof c.getDerivedStateFromError ? null : d.render();
        b.flags |= 1;
        null !== a && g ? (b.child = Ug(b, a.child, null, f), b.child = Ug(b, null, h, f)) : Xi(a, b, h, f);
        b.memoizedState = d.state;
        e && dg(b, c, true);
        return b.child;
      }
      function kj(a) {
        var b = a.stateNode;
        b.pendingContext ? ag(a, b.pendingContext, b.pendingContext !== b.context) : b.context && ag(a, b.context, false);
        yh(a, b.containerInfo);
      }
      function lj(a, b, c, d, e) {
        Ig();
        Jg(e);
        b.flags |= 256;
        Xi(a, b, c, d);
        return b.child;
      }
      var mj = { dehydrated: null, treeContext: null, retryLane: 0 };
      function nj(a) {
        return { baseLanes: a, cachePool: null, transitions: null };
      }
      function oj(a, b, c) {
        var d = b.pendingProps, e = L.current, f = false, g = 0 !== (b.flags & 128), h;
        (h = g) || (h = null !== a && null === a.memoizedState ? false : 0 !== (e & 2));
        if (h) f = true, b.flags &= -129;
        else if (null === a || null !== a.memoizedState) e |= 1;
        G(L, e & 1);
        if (null === a) {
          Eg(b);
          a = b.memoizedState;
          if (null !== a && (a = a.dehydrated, null !== a)) return 0 === (b.mode & 1) ? b.lanes = 1 : "$!" === a.data ? b.lanes = 8 : b.lanes = 1073741824, null;
          g = d.children;
          a = d.fallback;
          return f ? (d = b.mode, f = b.child, g = { mode: "hidden", children: g }, 0 === (d & 1) && null !== f ? (f.childLanes = 0, f.pendingProps = g) : f = pj(g, d, 0, null), a = Tg(a, d, c, null), f.return = b, a.return = b, f.sibling = a, b.child = f, b.child.memoizedState = nj(c), b.memoizedState = mj, a) : qj(b, g);
        }
        e = a.memoizedState;
        if (null !== e && (h = e.dehydrated, null !== h)) return rj(a, b, g, d, h, e, c);
        if (f) {
          f = d.fallback;
          g = b.mode;
          e = a.child;
          h = e.sibling;
          var k = { mode: "hidden", children: d.children };
          0 === (g & 1) && b.child !== e ? (d = b.child, d.childLanes = 0, d.pendingProps = k, b.deletions = null) : (d = Pg(e, k), d.subtreeFlags = e.subtreeFlags & 14680064);
          null !== h ? f = Pg(h, f) : (f = Tg(f, g, c, null), f.flags |= 2);
          f.return = b;
          d.return = b;
          d.sibling = f;
          b.child = d;
          d = f;
          f = b.child;
          g = a.child.memoizedState;
          g = null === g ? nj(c) : { baseLanes: g.baseLanes | c, cachePool: null, transitions: g.transitions };
          f.memoizedState = g;
          f.childLanes = a.childLanes & ~c;
          b.memoizedState = mj;
          return d;
        }
        f = a.child;
        a = f.sibling;
        d = Pg(f, { mode: "visible", children: d.children });
        0 === (b.mode & 1) && (d.lanes = c);
        d.return = b;
        d.sibling = null;
        null !== a && (c = b.deletions, null === c ? (b.deletions = [a], b.flags |= 16) : c.push(a));
        b.child = d;
        b.memoizedState = null;
        return d;
      }
      function qj(a, b) {
        b = pj({ mode: "visible", children: b }, a.mode, 0, null);
        b.return = a;
        return a.child = b;
      }
      function sj(a, b, c, d) {
        null !== d && Jg(d);
        Ug(b, a.child, null, c);
        a = qj(b, b.pendingProps.children);
        a.flags |= 2;
        b.memoizedState = null;
        return a;
      }
      function rj(a, b, c, d, e, f, g) {
        if (c) {
          if (b.flags & 256) return b.flags &= -257, d = Ki(Error(p(422))), sj(a, b, g, d);
          if (null !== b.memoizedState) return b.child = a.child, b.flags |= 128, null;
          f = d.fallback;
          e = b.mode;
          d = pj({ mode: "visible", children: d.children }, e, 0, null);
          f = Tg(f, e, g, null);
          f.flags |= 2;
          d.return = b;
          f.return = b;
          d.sibling = f;
          b.child = d;
          0 !== (b.mode & 1) && Ug(b, a.child, null, g);
          b.child.memoizedState = nj(g);
          b.memoizedState = mj;
          return f;
        }
        if (0 === (b.mode & 1)) return sj(a, b, g, null);
        if ("$!" === e.data) {
          d = e.nextSibling && e.nextSibling.dataset;
          if (d) var h = d.dgst;
          d = h;
          f = Error(p(419));
          d = Ki(f, d, void 0);
          return sj(a, b, g, d);
        }
        h = 0 !== (g & a.childLanes);
        if (dh || h) {
          d = Q;
          if (null !== d) {
            switch (g & -g) {
              case 4:
                e = 2;
                break;
              case 16:
                e = 8;
                break;
              case 64:
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
              case 4194304:
              case 8388608:
              case 16777216:
              case 33554432:
              case 67108864:
                e = 32;
                break;
              case 536870912:
                e = 268435456;
                break;
              default:
                e = 0;
            }
            e = 0 !== (e & (d.suspendedLanes | g)) ? 0 : e;
            0 !== e && e !== f.retryLane && (f.retryLane = e, ih(a, e), gi(d, a, e, -1));
          }
          tj();
          d = Ki(Error(p(421)));
          return sj(a, b, g, d);
        }
        if ("$?" === e.data) return b.flags |= 128, b.child = a.child, b = uj.bind(null, a), e._reactRetry = b, null;
        a = f.treeContext;
        yg = Lf(e.nextSibling);
        xg = b;
        I = true;
        zg = null;
        null !== a && (og[pg++] = rg, og[pg++] = sg, og[pg++] = qg, rg = a.id, sg = a.overflow, qg = b);
        b = qj(b, d.children);
        b.flags |= 4096;
        return b;
      }
      function vj(a, b, c) {
        a.lanes |= b;
        var d = a.alternate;
        null !== d && (d.lanes |= b);
        bh(a.return, b, c);
      }
      function wj(a, b, c, d, e) {
        var f = a.memoizedState;
        null === f ? a.memoizedState = { isBackwards: b, rendering: null, renderingStartTime: 0, last: d, tail: c, tailMode: e } : (f.isBackwards = b, f.rendering = null, f.renderingStartTime = 0, f.last = d, f.tail = c, f.tailMode = e);
      }
      function xj(a, b, c) {
        var d = b.pendingProps, e = d.revealOrder, f = d.tail;
        Xi(a, b, d.children, c);
        d = L.current;
        if (0 !== (d & 2)) d = d & 1 | 2, b.flags |= 128;
        else {
          if (null !== a && 0 !== (a.flags & 128)) a: for (a = b.child; null !== a; ) {
            if (13 === a.tag) null !== a.memoizedState && vj(a, c, b);
            else if (19 === a.tag) vj(a, c, b);
            else if (null !== a.child) {
              a.child.return = a;
              a = a.child;
              continue;
            }
            if (a === b) break a;
            for (; null === a.sibling; ) {
              if (null === a.return || a.return === b) break a;
              a = a.return;
            }
            a.sibling.return = a.return;
            a = a.sibling;
          }
          d &= 1;
        }
        G(L, d);
        if (0 === (b.mode & 1)) b.memoizedState = null;
        else switch (e) {
          case "forwards":
            c = b.child;
            for (e = null; null !== c; ) a = c.alternate, null !== a && null === Ch(a) && (e = c), c = c.sibling;
            c = e;
            null === c ? (e = b.child, b.child = null) : (e = c.sibling, c.sibling = null);
            wj(b, false, e, c, f);
            break;
          case "backwards":
            c = null;
            e = b.child;
            for (b.child = null; null !== e; ) {
              a = e.alternate;
              if (null !== a && null === Ch(a)) {
                b.child = e;
                break;
              }
              a = e.sibling;
              e.sibling = c;
              c = e;
              e = a;
            }
            wj(b, true, c, null, f);
            break;
          case "together":
            wj(b, false, null, null, void 0);
            break;
          default:
            b.memoizedState = null;
        }
        return b.child;
      }
      function ij(a, b) {
        0 === (b.mode & 1) && null !== a && (a.alternate = null, b.alternate = null, b.flags |= 2);
      }
      function Zi(a, b, c) {
        null !== a && (b.dependencies = a.dependencies);
        rh |= b.lanes;
        if (0 === (c & b.childLanes)) return null;
        if (null !== a && b.child !== a.child) throw Error(p(153));
        if (null !== b.child) {
          a = b.child;
          c = Pg(a, a.pendingProps);
          b.child = c;
          for (c.return = b; null !== a.sibling; ) a = a.sibling, c = c.sibling = Pg(a, a.pendingProps), c.return = b;
          c.sibling = null;
        }
        return b.child;
      }
      function yj(a, b, c) {
        switch (b.tag) {
          case 3:
            kj(b);
            Ig();
            break;
          case 5:
            Ah(b);
            break;
          case 1:
            Zf(b.type) && cg(b);
            break;
          case 4:
            yh(b, b.stateNode.containerInfo);
            break;
          case 10:
            var d = b.type._context, e = b.memoizedProps.value;
            G(Wg, d._currentValue);
            d._currentValue = e;
            break;
          case 13:
            d = b.memoizedState;
            if (null !== d) {
              if (null !== d.dehydrated) return G(L, L.current & 1), b.flags |= 128, null;
              if (0 !== (c & b.child.childLanes)) return oj(a, b, c);
              G(L, L.current & 1);
              a = Zi(a, b, c);
              return null !== a ? a.sibling : null;
            }
            G(L, L.current & 1);
            break;
          case 19:
            d = 0 !== (c & b.childLanes);
            if (0 !== (a.flags & 128)) {
              if (d) return xj(a, b, c);
              b.flags |= 128;
            }
            e = b.memoizedState;
            null !== e && (e.rendering = null, e.tail = null, e.lastEffect = null);
            G(L, L.current);
            if (d) break;
            else return null;
          case 22:
          case 23:
            return b.lanes = 0, dj(a, b, c);
        }
        return Zi(a, b, c);
      }
      var zj;
      var Aj;
      var Bj;
      var Cj;
      zj = function(a, b) {
        for (var c = b.child; null !== c; ) {
          if (5 === c.tag || 6 === c.tag) a.appendChild(c.stateNode);
          else if (4 !== c.tag && null !== c.child) {
            c.child.return = c;
            c = c.child;
            continue;
          }
          if (c === b) break;
          for (; null === c.sibling; ) {
            if (null === c.return || c.return === b) return;
            c = c.return;
          }
          c.sibling.return = c.return;
          c = c.sibling;
        }
      };
      Aj = function() {
      };
      Bj = function(a, b, c, d) {
        var e = a.memoizedProps;
        if (e !== d) {
          a = b.stateNode;
          xh(uh.current);
          var f = null;
          switch (c) {
            case "input":
              e = Ya(a, e);
              d = Ya(a, d);
              f = [];
              break;
            case "select":
              e = A({}, e, { value: void 0 });
              d = A({}, d, { value: void 0 });
              f = [];
              break;
            case "textarea":
              e = gb(a, e);
              d = gb(a, d);
              f = [];
              break;
            default:
              "function" !== typeof e.onClick && "function" === typeof d.onClick && (a.onclick = Bf);
          }
          ub(c, d);
          var g;
          c = null;
          for (l in e) if (!d.hasOwnProperty(l) && e.hasOwnProperty(l) && null != e[l]) if ("style" === l) {
            var h = e[l];
            for (g in h) h.hasOwnProperty(g) && (c || (c = {}), c[g] = "");
          } else "dangerouslySetInnerHTML" !== l && "children" !== l && "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && "autoFocus" !== l && (ea.hasOwnProperty(l) ? f || (f = []) : (f = f || []).push(l, null));
          for (l in d) {
            var k = d[l];
            h = null != e ? e[l] : void 0;
            if (d.hasOwnProperty(l) && k !== h && (null != k || null != h)) if ("style" === l) if (h) {
              for (g in h) !h.hasOwnProperty(g) || k && k.hasOwnProperty(g) || (c || (c = {}), c[g] = "");
              for (g in k) k.hasOwnProperty(g) && h[g] !== k[g] && (c || (c = {}), c[g] = k[g]);
            } else c || (f || (f = []), f.push(
              l,
              c
            )), c = k;
            else "dangerouslySetInnerHTML" === l ? (k = k ? k.__html : void 0, h = h ? h.__html : void 0, null != k && h !== k && (f = f || []).push(l, k)) : "children" === l ? "string" !== typeof k && "number" !== typeof k || (f = f || []).push(l, "" + k) : "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && (ea.hasOwnProperty(l) ? (null != k && "onScroll" === l && D("scroll", a), f || h === k || (f = [])) : (f = f || []).push(l, k));
          }
          c && (f = f || []).push("style", c);
          var l = f;
          if (b.updateQueue = l) b.flags |= 4;
        }
      };
      Cj = function(a, b, c, d) {
        c !== d && (b.flags |= 4);
      };
      function Dj(a, b) {
        if (!I) switch (a.tailMode) {
          case "hidden":
            b = a.tail;
            for (var c = null; null !== b; ) null !== b.alternate && (c = b), b = b.sibling;
            null === c ? a.tail = null : c.sibling = null;
            break;
          case "collapsed":
            c = a.tail;
            for (var d = null; null !== c; ) null !== c.alternate && (d = c), c = c.sibling;
            null === d ? b || null === a.tail ? a.tail = null : a.tail.sibling = null : d.sibling = null;
        }
      }
      function S(a) {
        var b = null !== a.alternate && a.alternate.child === a.child, c = 0, d = 0;
        if (b) for (var e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags & 14680064, d |= e.flags & 14680064, e.return = a, e = e.sibling;
        else for (e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags, d |= e.flags, e.return = a, e = e.sibling;
        a.subtreeFlags |= d;
        a.childLanes = c;
        return b;
      }
      function Ej(a, b, c) {
        var d = b.pendingProps;
        wg(b);
        switch (b.tag) {
          case 2:
          case 16:
          case 15:
          case 0:
          case 11:
          case 7:
          case 8:
          case 12:
          case 9:
          case 14:
            return S(b), null;
          case 1:
            return Zf(b.type) && $f(), S(b), null;
          case 3:
            d = b.stateNode;
            zh();
            E(Wf);
            E(H);
            Eh();
            d.pendingContext && (d.context = d.pendingContext, d.pendingContext = null);
            if (null === a || null === a.child) Gg(b) ? b.flags |= 4 : null === a || a.memoizedState.isDehydrated && 0 === (b.flags & 256) || (b.flags |= 1024, null !== zg && (Fj(zg), zg = null));
            Aj(a, b);
            S(b);
            return null;
          case 5:
            Bh(b);
            var e = xh(wh.current);
            c = b.type;
            if (null !== a && null != b.stateNode) Bj(a, b, c, d, e), a.ref !== b.ref && (b.flags |= 512, b.flags |= 2097152);
            else {
              if (!d) {
                if (null === b.stateNode) throw Error(p(166));
                S(b);
                return null;
              }
              a = xh(uh.current);
              if (Gg(b)) {
                d = b.stateNode;
                c = b.type;
                var f = b.memoizedProps;
                d[Of] = b;
                d[Pf] = f;
                a = 0 !== (b.mode & 1);
                switch (c) {
                  case "dialog":
                    D("cancel", d);
                    D("close", d);
                    break;
                  case "iframe":
                  case "object":
                  case "embed":
                    D("load", d);
                    break;
                  case "video":
                  case "audio":
                    for (e = 0; e < lf.length; e++) D(lf[e], d);
                    break;
                  case "source":
                    D("error", d);
                    break;
                  case "img":
                  case "image":
                  case "link":
                    D(
                      "error",
                      d
                    );
                    D("load", d);
                    break;
                  case "details":
                    D("toggle", d);
                    break;
                  case "input":
                    Za(d, f);
                    D("invalid", d);
                    break;
                  case "select":
                    d._wrapperState = { wasMultiple: !!f.multiple };
                    D("invalid", d);
                    break;
                  case "textarea":
                    hb(d, f), D("invalid", d);
                }
                ub(c, f);
                e = null;
                for (var g in f) if (f.hasOwnProperty(g)) {
                  var h = f[g];
                  "children" === g ? "string" === typeof h ? d.textContent !== h && (true !== f.suppressHydrationWarning && Af(d.textContent, h, a), e = ["children", h]) : "number" === typeof h && d.textContent !== "" + h && (true !== f.suppressHydrationWarning && Af(
                    d.textContent,
                    h,
                    a
                  ), e = ["children", "" + h]) : ea.hasOwnProperty(g) && null != h && "onScroll" === g && D("scroll", d);
                }
                switch (c) {
                  case "input":
                    Va(d);
                    db(d, f, true);
                    break;
                  case "textarea":
                    Va(d);
                    jb(d);
                    break;
                  case "select":
                  case "option":
                    break;
                  default:
                    "function" === typeof f.onClick && (d.onclick = Bf);
                }
                d = e;
                b.updateQueue = d;
                null !== d && (b.flags |= 4);
              } else {
                g = 9 === e.nodeType ? e : e.ownerDocument;
                "http://www.w3.org/1999/xhtml" === a && (a = kb(c));
                "http://www.w3.org/1999/xhtml" === a ? "script" === c ? (a = g.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild)) : "string" === typeof d.is ? a = g.createElement(c, { is: d.is }) : (a = g.createElement(c), "select" === c && (g = a, d.multiple ? g.multiple = true : d.size && (g.size = d.size))) : a = g.createElementNS(a, c);
                a[Of] = b;
                a[Pf] = d;
                zj(a, b, false, false);
                b.stateNode = a;
                a: {
                  g = vb(c, d);
                  switch (c) {
                    case "dialog":
                      D("cancel", a);
                      D("close", a);
                      e = d;
                      break;
                    case "iframe":
                    case "object":
                    case "embed":
                      D("load", a);
                      e = d;
                      break;
                    case "video":
                    case "audio":
                      for (e = 0; e < lf.length; e++) D(lf[e], a);
                      e = d;
                      break;
                    case "source":
                      D("error", a);
                      e = d;
                      break;
                    case "img":
                    case "image":
                    case "link":
                      D(
                        "error",
                        a
                      );
                      D("load", a);
                      e = d;
                      break;
                    case "details":
                      D("toggle", a);
                      e = d;
                      break;
                    case "input":
                      Za(a, d);
                      e = Ya(a, d);
                      D("invalid", a);
                      break;
                    case "option":
                      e = d;
                      break;
                    case "select":
                      a._wrapperState = { wasMultiple: !!d.multiple };
                      e = A({}, d, { value: void 0 });
                      D("invalid", a);
                      break;
                    case "textarea":
                      hb(a, d);
                      e = gb(a, d);
                      D("invalid", a);
                      break;
                    default:
                      e = d;
                  }
                  ub(c, e);
                  h = e;
                  for (f in h) if (h.hasOwnProperty(f)) {
                    var k = h[f];
                    "style" === f ? sb(a, k) : "dangerouslySetInnerHTML" === f ? (k = k ? k.__html : void 0, null != k && nb(a, k)) : "children" === f ? "string" === typeof k ? ("textarea" !== c || "" !== k) && ob(a, k) : "number" === typeof k && ob(a, "" + k) : "suppressContentEditableWarning" !== f && "suppressHydrationWarning" !== f && "autoFocus" !== f && (ea.hasOwnProperty(f) ? null != k && "onScroll" === f && D("scroll", a) : null != k && ta(a, f, k, g));
                  }
                  switch (c) {
                    case "input":
                      Va(a);
                      db(a, d, false);
                      break;
                    case "textarea":
                      Va(a);
                      jb(a);
                      break;
                    case "option":
                      null != d.value && a.setAttribute("value", "" + Sa(d.value));
                      break;
                    case "select":
                      a.multiple = !!d.multiple;
                      f = d.value;
                      null != f ? fb(a, !!d.multiple, f, false) : null != d.defaultValue && fb(
                        a,
                        !!d.multiple,
                        d.defaultValue,
                        true
                      );
                      break;
                    default:
                      "function" === typeof e.onClick && (a.onclick = Bf);
                  }
                  switch (c) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                      d = !!d.autoFocus;
                      break a;
                    case "img":
                      d = true;
                      break a;
                    default:
                      d = false;
                  }
                }
                d && (b.flags |= 4);
              }
              null !== b.ref && (b.flags |= 512, b.flags |= 2097152);
            }
            S(b);
            return null;
          case 6:
            if (a && null != b.stateNode) Cj(a, b, a.memoizedProps, d);
            else {
              if ("string" !== typeof d && null === b.stateNode) throw Error(p(166));
              c = xh(wh.current);
              xh(uh.current);
              if (Gg(b)) {
                d = b.stateNode;
                c = b.memoizedProps;
                d[Of] = b;
                if (f = d.nodeValue !== c) {
                  if (a = xg, null !== a) switch (a.tag) {
                    case 3:
                      Af(d.nodeValue, c, 0 !== (a.mode & 1));
                      break;
                    case 5:
                      true !== a.memoizedProps.suppressHydrationWarning && Af(d.nodeValue, c, 0 !== (a.mode & 1));
                  }
                }
                f && (b.flags |= 4);
              } else d = (9 === c.nodeType ? c : c.ownerDocument).createTextNode(d), d[Of] = b, b.stateNode = d;
            }
            S(b);
            return null;
          case 13:
            E(L);
            d = b.memoizedState;
            if (null === a || null !== a.memoizedState && null !== a.memoizedState.dehydrated) {
              if (I && null !== yg && 0 !== (b.mode & 1) && 0 === (b.flags & 128)) Hg(), Ig(), b.flags |= 98560, f = false;
              else if (f = Gg(b), null !== d && null !== d.dehydrated) {
                if (null === a) {
                  if (!f) throw Error(p(318));
                  f = b.memoizedState;
                  f = null !== f ? f.dehydrated : null;
                  if (!f) throw Error(p(317));
                  f[Of] = b;
                } else Ig(), 0 === (b.flags & 128) && (b.memoizedState = null), b.flags |= 4;
                S(b);
                f = false;
              } else null !== zg && (Fj(zg), zg = null), f = true;
              if (!f) return b.flags & 65536 ? b : null;
            }
            if (0 !== (b.flags & 128)) return b.lanes = c, b;
            d = null !== d;
            d !== (null !== a && null !== a.memoizedState) && d && (b.child.flags |= 8192, 0 !== (b.mode & 1) && (null === a || 0 !== (L.current & 1) ? 0 === T && (T = 3) : tj()));
            null !== b.updateQueue && (b.flags |= 4);
            S(b);
            return null;
          case 4:
            return zh(), Aj(a, b), null === a && sf(b.stateNode.containerInfo), S(b), null;
          case 10:
            return ah(b.type._context), S(b), null;
          case 17:
            return Zf(b.type) && $f(), S(b), null;
          case 19:
            E(L);
            f = b.memoizedState;
            if (null === f) return S(b), null;
            d = 0 !== (b.flags & 128);
            g = f.rendering;
            if (null === g) if (d) Dj(f, false);
            else {
              if (0 !== T || null !== a && 0 !== (a.flags & 128)) for (a = b.child; null !== a; ) {
                g = Ch(a);
                if (null !== g) {
                  b.flags |= 128;
                  Dj(f, false);
                  d = g.updateQueue;
                  null !== d && (b.updateQueue = d, b.flags |= 4);
                  b.subtreeFlags = 0;
                  d = c;
                  for (c = b.child; null !== c; ) f = c, a = d, f.flags &= 14680066, g = f.alternate, null === g ? (f.childLanes = 0, f.lanes = a, f.child = null, f.subtreeFlags = 0, f.memoizedProps = null, f.memoizedState = null, f.updateQueue = null, f.dependencies = null, f.stateNode = null) : (f.childLanes = g.childLanes, f.lanes = g.lanes, f.child = g.child, f.subtreeFlags = 0, f.deletions = null, f.memoizedProps = g.memoizedProps, f.memoizedState = g.memoizedState, f.updateQueue = g.updateQueue, f.type = g.type, a = g.dependencies, f.dependencies = null === a ? null : { lanes: a.lanes, firstContext: a.firstContext }), c = c.sibling;
                  G(L, L.current & 1 | 2);
                  return b.child;
                }
                a = a.sibling;
              }
              null !== f.tail && B() > Gj && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
            }
            else {
              if (!d) if (a = Ch(g), null !== a) {
                if (b.flags |= 128, d = true, c = a.updateQueue, null !== c && (b.updateQueue = c, b.flags |= 4), Dj(f, true), null === f.tail && "hidden" === f.tailMode && !g.alternate && !I) return S(b), null;
              } else 2 * B() - f.renderingStartTime > Gj && 1073741824 !== c && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
              f.isBackwards ? (g.sibling = b.child, b.child = g) : (c = f.last, null !== c ? c.sibling = g : b.child = g, f.last = g);
            }
            if (null !== f.tail) return b = f.tail, f.rendering = b, f.tail = b.sibling, f.renderingStartTime = B(), b.sibling = null, c = L.current, G(L, d ? c & 1 | 2 : c & 1), b;
            S(b);
            return null;
          case 22:
          case 23:
            return Hj(), d = null !== b.memoizedState, null !== a && null !== a.memoizedState !== d && (b.flags |= 8192), d && 0 !== (b.mode & 1) ? 0 !== (fj & 1073741824) && (S(b), b.subtreeFlags & 6 && (b.flags |= 8192)) : S(b), null;
          case 24:
            return null;
          case 25:
            return null;
        }
        throw Error(p(156, b.tag));
      }
      function Ij(a, b) {
        wg(b);
        switch (b.tag) {
          case 1:
            return Zf(b.type) && $f(), a = b.flags, a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
          case 3:
            return zh(), E(Wf), E(H), Eh(), a = b.flags, 0 !== (a & 65536) && 0 === (a & 128) ? (b.flags = a & -65537 | 128, b) : null;
          case 5:
            return Bh(b), null;
          case 13:
            E(L);
            a = b.memoizedState;
            if (null !== a && null !== a.dehydrated) {
              if (null === b.alternate) throw Error(p(340));
              Ig();
            }
            a = b.flags;
            return a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
          case 19:
            return E(L), null;
          case 4:
            return zh(), null;
          case 10:
            return ah(b.type._context), null;
          case 22:
          case 23:
            return Hj(), null;
          case 24:
            return null;
          default:
            return null;
        }
      }
      var Jj = false;
      var U = false;
      var Kj = "function" === typeof WeakSet ? WeakSet : Set;
      var V = null;
      function Lj(a, b) {
        var c = a.ref;
        if (null !== c) if ("function" === typeof c) try {
          c(null);
        } catch (d) {
          W(a, b, d);
        }
        else c.current = null;
      }
      function Mj(a, b, c) {
        try {
          c();
        } catch (d) {
          W(a, b, d);
        }
      }
      var Nj = false;
      function Oj(a, b) {
        Cf = dd;
        a = Me();
        if (Ne(a)) {
          if ("selectionStart" in a) var c = { start: a.selectionStart, end: a.selectionEnd };
          else a: {
            c = (c = a.ownerDocument) && c.defaultView || window;
            var d = c.getSelection && c.getSelection();
            if (d && 0 !== d.rangeCount) {
              c = d.anchorNode;
              var e = d.anchorOffset, f = d.focusNode;
              d = d.focusOffset;
              try {
                c.nodeType, f.nodeType;
              } catch (F) {
                c = null;
                break a;
              }
              var g = 0, h = -1, k = -1, l = 0, m = 0, q = a, r = null;
              b: for (; ; ) {
                for (var y; ; ) {
                  q !== c || 0 !== e && 3 !== q.nodeType || (h = g + e);
                  q !== f || 0 !== d && 3 !== q.nodeType || (k = g + d);
                  3 === q.nodeType && (g += q.nodeValue.length);
                  if (null === (y = q.firstChild)) break;
                  r = q;
                  q = y;
                }
                for (; ; ) {
                  if (q === a) break b;
                  r === c && ++l === e && (h = g);
                  r === f && ++m === d && (k = g);
                  if (null !== (y = q.nextSibling)) break;
                  q = r;
                  r = q.parentNode;
                }
                q = y;
              }
              c = -1 === h || -1 === k ? null : { start: h, end: k };
            } else c = null;
          }
          c = c || { start: 0, end: 0 };
        } else c = null;
        Df = { focusedElem: a, selectionRange: c };
        dd = false;
        for (V = b; null !== V; ) if (b = V, a = b.child, 0 !== (b.subtreeFlags & 1028) && null !== a) a.return = b, V = a;
        else for (; null !== V; ) {
          b = V;
          try {
            var n = b.alternate;
            if (0 !== (b.flags & 1024)) switch (b.tag) {
              case 0:
              case 11:
              case 15:
                break;
              case 1:
                if (null !== n) {
                  var t3 = n.memoizedProps, J = n.memoizedState, x = b.stateNode, w = x.getSnapshotBeforeUpdate(b.elementType === b.type ? t3 : Ci(b.type, t3), J);
                  x.__reactInternalSnapshotBeforeUpdate = w;
                }
                break;
              case 3:
                var u = b.stateNode.containerInfo;
                1 === u.nodeType ? u.textContent = "" : 9 === u.nodeType && u.documentElement && u.removeChild(u.documentElement);
                break;
              case 5:
              case 6:
              case 4:
              case 17:
                break;
              default:
                throw Error(p(163));
            }
          } catch (F) {
            W(b, b.return, F);
          }
          a = b.sibling;
          if (null !== a) {
            a.return = b.return;
            V = a;
            break;
          }
          V = b.return;
        }
        n = Nj;
        Nj = false;
        return n;
      }
      function Pj(a, b, c) {
        var d = b.updateQueue;
        d = null !== d ? d.lastEffect : null;
        if (null !== d) {
          var e = d = d.next;
          do {
            if ((e.tag & a) === a) {
              var f = e.destroy;
              e.destroy = void 0;
              void 0 !== f && Mj(b, c, f);
            }
            e = e.next;
          } while (e !== d);
        }
      }
      function Qj(a, b) {
        b = b.updateQueue;
        b = null !== b ? b.lastEffect : null;
        if (null !== b) {
          var c = b = b.next;
          do {
            if ((c.tag & a) === a) {
              var d = c.create;
              c.destroy = d();
            }
            c = c.next;
          } while (c !== b);
        }
      }
      function Rj(a) {
        var b = a.ref;
        if (null !== b) {
          var c = a.stateNode;
          switch (a.tag) {
            case 5:
              a = c;
              break;
            default:
              a = c;
          }
          "function" === typeof b ? b(a) : b.current = a;
        }
      }
      function Sj(a) {
        var b = a.alternate;
        null !== b && (a.alternate = null, Sj(b));
        a.child = null;
        a.deletions = null;
        a.sibling = null;
        5 === a.tag && (b = a.stateNode, null !== b && (delete b[Of], delete b[Pf], delete b[of], delete b[Qf], delete b[Rf]));
        a.stateNode = null;
        a.return = null;
        a.dependencies = null;
        a.memoizedProps = null;
        a.memoizedState = null;
        a.pendingProps = null;
        a.stateNode = null;
        a.updateQueue = null;
      }
      function Tj(a) {
        return 5 === a.tag || 3 === a.tag || 4 === a.tag;
      }
      function Uj(a) {
        a: for (; ; ) {
          for (; null === a.sibling; ) {
            if (null === a.return || Tj(a.return)) return null;
            a = a.return;
          }
          a.sibling.return = a.return;
          for (a = a.sibling; 5 !== a.tag && 6 !== a.tag && 18 !== a.tag; ) {
            if (a.flags & 2) continue a;
            if (null === a.child || 4 === a.tag) continue a;
            else a.child.return = a, a = a.child;
          }
          if (!(a.flags & 2)) return a.stateNode;
        }
      }
      function Vj(a, b, c) {
        var d = a.tag;
        if (5 === d || 6 === d) a = a.stateNode, b ? 8 === c.nodeType ? c.parentNode.insertBefore(a, b) : c.insertBefore(a, b) : (8 === c.nodeType ? (b = c.parentNode, b.insertBefore(a, c)) : (b = c, b.appendChild(a)), c = c._reactRootContainer, null !== c && void 0 !== c || null !== b.onclick || (b.onclick = Bf));
        else if (4 !== d && (a = a.child, null !== a)) for (Vj(a, b, c), a = a.sibling; null !== a; ) Vj(a, b, c), a = a.sibling;
      }
      function Wj(a, b, c) {
        var d = a.tag;
        if (5 === d || 6 === d) a = a.stateNode, b ? c.insertBefore(a, b) : c.appendChild(a);
        else if (4 !== d && (a = a.child, null !== a)) for (Wj(a, b, c), a = a.sibling; null !== a; ) Wj(a, b, c), a = a.sibling;
      }
      var X = null;
      var Xj = false;
      function Yj(a, b, c) {
        for (c = c.child; null !== c; ) Zj(a, b, c), c = c.sibling;
      }
      function Zj(a, b, c) {
        if (lc && "function" === typeof lc.onCommitFiberUnmount) try {
          lc.onCommitFiberUnmount(kc, c);
        } catch (h) {
        }
        switch (c.tag) {
          case 5:
            U || Lj(c, b);
          case 6:
            var d = X, e = Xj;
            X = null;
            Yj(a, b, c);
            X = d;
            Xj = e;
            null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? a.parentNode.removeChild(c) : a.removeChild(c)) : X.removeChild(c.stateNode));
            break;
          case 18:
            null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? Kf(a.parentNode, c) : 1 === a.nodeType && Kf(a, c), bd(a)) : Kf(X, c.stateNode));
            break;
          case 4:
            d = X;
            e = Xj;
            X = c.stateNode.containerInfo;
            Xj = true;
            Yj(a, b, c);
            X = d;
            Xj = e;
            break;
          case 0:
          case 11:
          case 14:
          case 15:
            if (!U && (d = c.updateQueue, null !== d && (d = d.lastEffect, null !== d))) {
              e = d = d.next;
              do {
                var f = e, g = f.destroy;
                f = f.tag;
                void 0 !== g && (0 !== (f & 2) ? Mj(c, b, g) : 0 !== (f & 4) && Mj(c, b, g));
                e = e.next;
              } while (e !== d);
            }
            Yj(a, b, c);
            break;
          case 1:
            if (!U && (Lj(c, b), d = c.stateNode, "function" === typeof d.componentWillUnmount)) try {
              d.props = c.memoizedProps, d.state = c.memoizedState, d.componentWillUnmount();
            } catch (h) {
              W(c, b, h);
            }
            Yj(a, b, c);
            break;
          case 21:
            Yj(a, b, c);
            break;
          case 22:
            c.mode & 1 ? (U = (d = U) || null !== c.memoizedState, Yj(a, b, c), U = d) : Yj(a, b, c);
            break;
          default:
            Yj(a, b, c);
        }
      }
      function ak(a) {
        var b = a.updateQueue;
        if (null !== b) {
          a.updateQueue = null;
          var c = a.stateNode;
          null === c && (c = a.stateNode = new Kj());
          b.forEach(function(b2) {
            var d = bk.bind(null, a, b2);
            c.has(b2) || (c.add(b2), b2.then(d, d));
          });
        }
      }
      function ck(a, b) {
        var c = b.deletions;
        if (null !== c) for (var d = 0; d < c.length; d++) {
          var e = c[d];
          try {
            var f = a, g = b, h = g;
            a: for (; null !== h; ) {
              switch (h.tag) {
                case 5:
                  X = h.stateNode;
                  Xj = false;
                  break a;
                case 3:
                  X = h.stateNode.containerInfo;
                  Xj = true;
                  break a;
                case 4:
                  X = h.stateNode.containerInfo;
                  Xj = true;
                  break a;
              }
              h = h.return;
            }
            if (null === X) throw Error(p(160));
            Zj(f, g, e);
            X = null;
            Xj = false;
            var k = e.alternate;
            null !== k && (k.return = null);
            e.return = null;
          } catch (l) {
            W(e, b, l);
          }
        }
        if (b.subtreeFlags & 12854) for (b = b.child; null !== b; ) dk(b, a), b = b.sibling;
      }
      function dk(a, b) {
        var c = a.alternate, d = a.flags;
        switch (a.tag) {
          case 0:
          case 11:
          case 14:
          case 15:
            ck(b, a);
            ek(a);
            if (d & 4) {
              try {
                Pj(3, a, a.return), Qj(3, a);
              } catch (t3) {
                W(a, a.return, t3);
              }
              try {
                Pj(5, a, a.return);
              } catch (t3) {
                W(a, a.return, t3);
              }
            }
            break;
          case 1:
            ck(b, a);
            ek(a);
            d & 512 && null !== c && Lj(c, c.return);
            break;
          case 5:
            ck(b, a);
            ek(a);
            d & 512 && null !== c && Lj(c, c.return);
            if (a.flags & 32) {
              var e = a.stateNode;
              try {
                ob(e, "");
              } catch (t3) {
                W(a, a.return, t3);
              }
            }
            if (d & 4 && (e = a.stateNode, null != e)) {
              var f = a.memoizedProps, g = null !== c ? c.memoizedProps : f, h = a.type, k = a.updateQueue;
              a.updateQueue = null;
              if (null !== k) try {
                "input" === h && "radio" === f.type && null != f.name && ab(e, f);
                vb(h, g);
                var l = vb(h, f);
                for (g = 0; g < k.length; g += 2) {
                  var m = k[g], q = k[g + 1];
                  "style" === m ? sb(e, q) : "dangerouslySetInnerHTML" === m ? nb(e, q) : "children" === m ? ob(e, q) : ta(e, m, q, l);
                }
                switch (h) {
                  case "input":
                    bb(e, f);
                    break;
                  case "textarea":
                    ib(e, f);
                    break;
                  case "select":
                    var r = e._wrapperState.wasMultiple;
                    e._wrapperState.wasMultiple = !!f.multiple;
                    var y = f.value;
                    null != y ? fb(e, !!f.multiple, y, false) : r !== !!f.multiple && (null != f.defaultValue ? fb(
                      e,
                      !!f.multiple,
                      f.defaultValue,
                      true
                    ) : fb(e, !!f.multiple, f.multiple ? [] : "", false));
                }
                e[Pf] = f;
              } catch (t3) {
                W(a, a.return, t3);
              }
            }
            break;
          case 6:
            ck(b, a);
            ek(a);
            if (d & 4) {
              if (null === a.stateNode) throw Error(p(162));
              e = a.stateNode;
              f = a.memoizedProps;
              try {
                e.nodeValue = f;
              } catch (t3) {
                W(a, a.return, t3);
              }
            }
            break;
          case 3:
            ck(b, a);
            ek(a);
            if (d & 4 && null !== c && c.memoizedState.isDehydrated) try {
              bd(b.containerInfo);
            } catch (t3) {
              W(a, a.return, t3);
            }
            break;
          case 4:
            ck(b, a);
            ek(a);
            break;
          case 13:
            ck(b, a);
            ek(a);
            e = a.child;
            e.flags & 8192 && (f = null !== e.memoizedState, e.stateNode.isHidden = f, !f || null !== e.alternate && null !== e.alternate.memoizedState || (fk = B()));
            d & 4 && ak(a);
            break;
          case 22:
            m = null !== c && null !== c.memoizedState;
            a.mode & 1 ? (U = (l = U) || m, ck(b, a), U = l) : ck(b, a);
            ek(a);
            if (d & 8192) {
              l = null !== a.memoizedState;
              if ((a.stateNode.isHidden = l) && !m && 0 !== (a.mode & 1)) for (V = a, m = a.child; null !== m; ) {
                for (q = V = m; null !== V; ) {
                  r = V;
                  y = r.child;
                  switch (r.tag) {
                    case 0:
                    case 11:
                    case 14:
                    case 15:
                      Pj(4, r, r.return);
                      break;
                    case 1:
                      Lj(r, r.return);
                      var n = r.stateNode;
                      if ("function" === typeof n.componentWillUnmount) {
                        d = r;
                        c = r.return;
                        try {
                          b = d, n.props = b.memoizedProps, n.state = b.memoizedState, n.componentWillUnmount();
                        } catch (t3) {
                          W(d, c, t3);
                        }
                      }
                      break;
                    case 5:
                      Lj(r, r.return);
                      break;
                    case 22:
                      if (null !== r.memoizedState) {
                        gk(q);
                        continue;
                      }
                  }
                  null !== y ? (y.return = r, V = y) : gk(q);
                }
                m = m.sibling;
              }
              a: for (m = null, q = a; ; ) {
                if (5 === q.tag) {
                  if (null === m) {
                    m = q;
                    try {
                      e = q.stateNode, l ? (f = e.style, "function" === typeof f.setProperty ? f.setProperty("display", "none", "important") : f.display = "none") : (h = q.stateNode, k = q.memoizedProps.style, g = void 0 !== k && null !== k && k.hasOwnProperty("display") ? k.display : null, h.style.display = rb("display", g));
                    } catch (t3) {
                      W(a, a.return, t3);
                    }
                  }
                } else if (6 === q.tag) {
                  if (null === m) try {
                    q.stateNode.nodeValue = l ? "" : q.memoizedProps;
                  } catch (t3) {
                    W(a, a.return, t3);
                  }
                } else if ((22 !== q.tag && 23 !== q.tag || null === q.memoizedState || q === a) && null !== q.child) {
                  q.child.return = q;
                  q = q.child;
                  continue;
                }
                if (q === a) break a;
                for (; null === q.sibling; ) {
                  if (null === q.return || q.return === a) break a;
                  m === q && (m = null);
                  q = q.return;
                }
                m === q && (m = null);
                q.sibling.return = q.return;
                q = q.sibling;
              }
            }
            break;
          case 19:
            ck(b, a);
            ek(a);
            d & 4 && ak(a);
            break;
          case 21:
            break;
          default:
            ck(
              b,
              a
            ), ek(a);
        }
      }
      function ek(a) {
        var b = a.flags;
        if (b & 2) {
          try {
            a: {
              for (var c = a.return; null !== c; ) {
                if (Tj(c)) {
                  var d = c;
                  break a;
                }
                c = c.return;
              }
              throw Error(p(160));
            }
            switch (d.tag) {
              case 5:
                var e = d.stateNode;
                d.flags & 32 && (ob(e, ""), d.flags &= -33);
                var f = Uj(a);
                Wj(a, f, e);
                break;
              case 3:
              case 4:
                var g = d.stateNode.containerInfo, h = Uj(a);
                Vj(a, h, g);
                break;
              default:
                throw Error(p(161));
            }
          } catch (k) {
            W(a, a.return, k);
          }
          a.flags &= -3;
        }
        b & 4096 && (a.flags &= -4097);
      }
      function hk(a, b, c) {
        V = a;
        ik(a, b, c);
      }
      function ik(a, b, c) {
        for (var d = 0 !== (a.mode & 1); null !== V; ) {
          var e = V, f = e.child;
          if (22 === e.tag && d) {
            var g = null !== e.memoizedState || Jj;
            if (!g) {
              var h = e.alternate, k = null !== h && null !== h.memoizedState || U;
              h = Jj;
              var l = U;
              Jj = g;
              if ((U = k) && !l) for (V = e; null !== V; ) g = V, k = g.child, 22 === g.tag && null !== g.memoizedState ? jk(e) : null !== k ? (k.return = g, V = k) : jk(e);
              for (; null !== f; ) V = f, ik(f, b, c), f = f.sibling;
              V = e;
              Jj = h;
              U = l;
            }
            kk(a, b, c);
          } else 0 !== (e.subtreeFlags & 8772) && null !== f ? (f.return = e, V = f) : kk(a, b, c);
        }
      }
      function kk(a) {
        for (; null !== V; ) {
          var b = V;
          if (0 !== (b.flags & 8772)) {
            var c = b.alternate;
            try {
              if (0 !== (b.flags & 8772)) switch (b.tag) {
                case 0:
                case 11:
                case 15:
                  U || Qj(5, b);
                  break;
                case 1:
                  var d = b.stateNode;
                  if (b.flags & 4 && !U) if (null === c) d.componentDidMount();
                  else {
                    var e = b.elementType === b.type ? c.memoizedProps : Ci(b.type, c.memoizedProps);
                    d.componentDidUpdate(e, c.memoizedState, d.__reactInternalSnapshotBeforeUpdate);
                  }
                  var f = b.updateQueue;
                  null !== f && sh(b, f, d);
                  break;
                case 3:
                  var g = b.updateQueue;
                  if (null !== g) {
                    c = null;
                    if (null !== b.child) switch (b.child.tag) {
                      case 5:
                        c = b.child.stateNode;
                        break;
                      case 1:
                        c = b.child.stateNode;
                    }
                    sh(b, g, c);
                  }
                  break;
                case 5:
                  var h = b.stateNode;
                  if (null === c && b.flags & 4) {
                    c = h;
                    var k = b.memoizedProps;
                    switch (b.type) {
                      case "button":
                      case "input":
                      case "select":
                      case "textarea":
                        k.autoFocus && c.focus();
                        break;
                      case "img":
                        k.src && (c.src = k.src);
                    }
                  }
                  break;
                case 6:
                  break;
                case 4:
                  break;
                case 12:
                  break;
                case 13:
                  if (null === b.memoizedState) {
                    var l = b.alternate;
                    if (null !== l) {
                      var m = l.memoizedState;
                      if (null !== m) {
                        var q = m.dehydrated;
                        null !== q && bd(q);
                      }
                    }
                  }
                  break;
                case 19:
                case 17:
                case 21:
                case 22:
                case 23:
                case 25:
                  break;
                default:
                  throw Error(p(163));
              }
              U || b.flags & 512 && Rj(b);
            } catch (r) {
              W(b, b.return, r);
            }
          }
          if (b === a) {
            V = null;
            break;
          }
          c = b.sibling;
          if (null !== c) {
            c.return = b.return;
            V = c;
            break;
          }
          V = b.return;
        }
      }
      function gk(a) {
        for (; null !== V; ) {
          var b = V;
          if (b === a) {
            V = null;
            break;
          }
          var c = b.sibling;
          if (null !== c) {
            c.return = b.return;
            V = c;
            break;
          }
          V = b.return;
        }
      }
      function jk(a) {
        for (; null !== V; ) {
          var b = V;
          try {
            switch (b.tag) {
              case 0:
              case 11:
              case 15:
                var c = b.return;
                try {
                  Qj(4, b);
                } catch (k) {
                  W(b, c, k);
                }
                break;
              case 1:
                var d = b.stateNode;
                if ("function" === typeof d.componentDidMount) {
                  var e = b.return;
                  try {
                    d.componentDidMount();
                  } catch (k) {
                    W(b, e, k);
                  }
                }
                var f = b.return;
                try {
                  Rj(b);
                } catch (k) {
                  W(b, f, k);
                }
                break;
              case 5:
                var g = b.return;
                try {
                  Rj(b);
                } catch (k) {
                  W(b, g, k);
                }
            }
          } catch (k) {
            W(b, b.return, k);
          }
          if (b === a) {
            V = null;
            break;
          }
          var h = b.sibling;
          if (null !== h) {
            h.return = b.return;
            V = h;
            break;
          }
          V = b.return;
        }
      }
      var lk = Math.ceil;
      var mk = ua.ReactCurrentDispatcher;
      var nk = ua.ReactCurrentOwner;
      var ok = ua.ReactCurrentBatchConfig;
      var K = 0;
      var Q = null;
      var Y = null;
      var Z = 0;
      var fj = 0;
      var ej = Uf(0);
      var T = 0;
      var pk = null;
      var rh = 0;
      var qk = 0;
      var rk = 0;
      var sk = null;
      var tk = null;
      var fk = 0;
      var Gj = Infinity;
      var uk = null;
      var Oi = false;
      var Pi = null;
      var Ri = null;
      var vk = false;
      var wk = null;
      var xk = 0;
      var yk = 0;
      var zk = null;
      var Ak = -1;
      var Bk = 0;
      function R() {
        return 0 !== (K & 6) ? B() : -1 !== Ak ? Ak : Ak = B();
      }
      function yi(a) {
        if (0 === (a.mode & 1)) return 1;
        if (0 !== (K & 2) && 0 !== Z) return Z & -Z;
        if (null !== Kg.transition) return 0 === Bk && (Bk = yc()), Bk;
        a = C;
        if (0 !== a) return a;
        a = window.event;
        a = void 0 === a ? 16 : jd(a.type);
        return a;
      }
      function gi(a, b, c, d) {
        if (50 < yk) throw yk = 0, zk = null, Error(p(185));
        Ac(a, c, d);
        if (0 === (K & 2) || a !== Q) a === Q && (0 === (K & 2) && (qk |= c), 4 === T && Ck(a, Z)), Dk(a, d), 1 === c && 0 === K && 0 === (b.mode & 1) && (Gj = B() + 500, fg && jg());
      }
      function Dk(a, b) {
        var c = a.callbackNode;
        wc(a, b);
        var d = uc(a, a === Q ? Z : 0);
        if (0 === d) null !== c && bc(c), a.callbackNode = null, a.callbackPriority = 0;
        else if (b = d & -d, a.callbackPriority !== b) {
          null != c && bc(c);
          if (1 === b) 0 === a.tag ? ig(Ek.bind(null, a)) : hg(Ek.bind(null, a)), Jf(function() {
            0 === (K & 6) && jg();
          }), c = null;
          else {
            switch (Dc(d)) {
              case 1:
                c = fc;
                break;
              case 4:
                c = gc;
                break;
              case 16:
                c = hc;
                break;
              case 536870912:
                c = jc;
                break;
              default:
                c = hc;
            }
            c = Fk(c, Gk.bind(null, a));
          }
          a.callbackPriority = b;
          a.callbackNode = c;
        }
      }
      function Gk(a, b) {
        Ak = -1;
        Bk = 0;
        if (0 !== (K & 6)) throw Error(p(327));
        var c = a.callbackNode;
        if (Hk() && a.callbackNode !== c) return null;
        var d = uc(a, a === Q ? Z : 0);
        if (0 === d) return null;
        if (0 !== (d & 30) || 0 !== (d & a.expiredLanes) || b) b = Ik(a, d);
        else {
          b = d;
          var e = K;
          K |= 2;
          var f = Jk();
          if (Q !== a || Z !== b) uk = null, Gj = B() + 500, Kk(a, b);
          do
            try {
              Lk();
              break;
            } catch (h) {
              Mk(a, h);
            }
          while (1);
          $g();
          mk.current = f;
          K = e;
          null !== Y ? b = 0 : (Q = null, Z = 0, b = T);
        }
        if (0 !== b) {
          2 === b && (e = xc(a), 0 !== e && (d = e, b = Nk(a, e)));
          if (1 === b) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
          if (6 === b) Ck(a, d);
          else {
            e = a.current.alternate;
            if (0 === (d & 30) && !Ok(e) && (b = Ik(a, d), 2 === b && (f = xc(a), 0 !== f && (d = f, b = Nk(a, f))), 1 === b)) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
            a.finishedWork = e;
            a.finishedLanes = d;
            switch (b) {
              case 0:
              case 1:
                throw Error(p(345));
              case 2:
                Pk(a, tk, uk);
                break;
              case 3:
                Ck(a, d);
                if ((d & 130023424) === d && (b = fk + 500 - B(), 10 < b)) {
                  if (0 !== uc(a, 0)) break;
                  e = a.suspendedLanes;
                  if ((e & d) !== d) {
                    R();
                    a.pingedLanes |= a.suspendedLanes & e;
                    break;
                  }
                  a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), b);
                  break;
                }
                Pk(a, tk, uk);
                break;
              case 4:
                Ck(a, d);
                if ((d & 4194240) === d) break;
                b = a.eventTimes;
                for (e = -1; 0 < d; ) {
                  var g = 31 - oc(d);
                  f = 1 << g;
                  g = b[g];
                  g > e && (e = g);
                  d &= ~f;
                }
                d = e;
                d = B() - d;
                d = (120 > d ? 120 : 480 > d ? 480 : 1080 > d ? 1080 : 1920 > d ? 1920 : 3e3 > d ? 3e3 : 4320 > d ? 4320 : 1960 * lk(d / 1960)) - d;
                if (10 < d) {
                  a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), d);
                  break;
                }
                Pk(a, tk, uk);
                break;
              case 5:
                Pk(a, tk, uk);
                break;
              default:
                throw Error(p(329));
            }
          }
        }
        Dk(a, B());
        return a.callbackNode === c ? Gk.bind(null, a) : null;
      }
      function Nk(a, b) {
        var c = sk;
        a.current.memoizedState.isDehydrated && (Kk(a, b).flags |= 256);
        a = Ik(a, b);
        2 !== a && (b = tk, tk = c, null !== b && Fj(b));
        return a;
      }
      function Fj(a) {
        null === tk ? tk = a : tk.push.apply(tk, a);
      }
      function Ok(a) {
        for (var b = a; ; ) {
          if (b.flags & 16384) {
            var c = b.updateQueue;
            if (null !== c && (c = c.stores, null !== c)) for (var d = 0; d < c.length; d++) {
              var e = c[d], f = e.getSnapshot;
              e = e.value;
              try {
                if (!He(f(), e)) return false;
              } catch (g) {
                return false;
              }
            }
          }
          c = b.child;
          if (b.subtreeFlags & 16384 && null !== c) c.return = b, b = c;
          else {
            if (b === a) break;
            for (; null === b.sibling; ) {
              if (null === b.return || b.return === a) return true;
              b = b.return;
            }
            b.sibling.return = b.return;
            b = b.sibling;
          }
        }
        return true;
      }
      function Ck(a, b) {
        b &= ~rk;
        b &= ~qk;
        a.suspendedLanes |= b;
        a.pingedLanes &= ~b;
        for (a = a.expirationTimes; 0 < b; ) {
          var c = 31 - oc(b), d = 1 << c;
          a[c] = -1;
          b &= ~d;
        }
      }
      function Ek(a) {
        if (0 !== (K & 6)) throw Error(p(327));
        Hk();
        var b = uc(a, 0);
        if (0 === (b & 1)) return Dk(a, B()), null;
        var c = Ik(a, b);
        if (0 !== a.tag && 2 === c) {
          var d = xc(a);
          0 !== d && (b = d, c = Nk(a, d));
        }
        if (1 === c) throw c = pk, Kk(a, 0), Ck(a, b), Dk(a, B()), c;
        if (6 === c) throw Error(p(345));
        a.finishedWork = a.current.alternate;
        a.finishedLanes = b;
        Pk(a, tk, uk);
        Dk(a, B());
        return null;
      }
      function Qk(a, b) {
        var c = K;
        K |= 1;
        try {
          return a(b);
        } finally {
          K = c, 0 === K && (Gj = B() + 500, fg && jg());
        }
      }
      function Rk(a) {
        null !== wk && 0 === wk.tag && 0 === (K & 6) && Hk();
        var b = K;
        K |= 1;
        var c = ok.transition, d = C;
        try {
          if (ok.transition = null, C = 1, a) return a();
        } finally {
          C = d, ok.transition = c, K = b, 0 === (K & 6) && jg();
        }
      }
      function Hj() {
        fj = ej.current;
        E(ej);
      }
      function Kk(a, b) {
        a.finishedWork = null;
        a.finishedLanes = 0;
        var c = a.timeoutHandle;
        -1 !== c && (a.timeoutHandle = -1, Gf(c));
        if (null !== Y) for (c = Y.return; null !== c; ) {
          var d = c;
          wg(d);
          switch (d.tag) {
            case 1:
              d = d.type.childContextTypes;
              null !== d && void 0 !== d && $f();
              break;
            case 3:
              zh();
              E(Wf);
              E(H);
              Eh();
              break;
            case 5:
              Bh(d);
              break;
            case 4:
              zh();
              break;
            case 13:
              E(L);
              break;
            case 19:
              E(L);
              break;
            case 10:
              ah(d.type._context);
              break;
            case 22:
            case 23:
              Hj();
          }
          c = c.return;
        }
        Q = a;
        Y = a = Pg(a.current, null);
        Z = fj = b;
        T = 0;
        pk = null;
        rk = qk = rh = 0;
        tk = sk = null;
        if (null !== fh) {
          for (b = 0; b < fh.length; b++) if (c = fh[b], d = c.interleaved, null !== d) {
            c.interleaved = null;
            var e = d.next, f = c.pending;
            if (null !== f) {
              var g = f.next;
              f.next = e;
              d.next = g;
            }
            c.pending = d;
          }
          fh = null;
        }
        return a;
      }
      function Mk(a, b) {
        do {
          var c = Y;
          try {
            $g();
            Fh.current = Rh;
            if (Ih) {
              for (var d = M.memoizedState; null !== d; ) {
                var e = d.queue;
                null !== e && (e.pending = null);
                d = d.next;
              }
              Ih = false;
            }
            Hh = 0;
            O = N = M = null;
            Jh = false;
            Kh = 0;
            nk.current = null;
            if (null === c || null === c.return) {
              T = 1;
              pk = b;
              Y = null;
              break;
            }
            a: {
              var f = a, g = c.return, h = c, k = b;
              b = Z;
              h.flags |= 32768;
              if (null !== k && "object" === typeof k && "function" === typeof k.then) {
                var l = k, m = h, q = m.tag;
                if (0 === (m.mode & 1) && (0 === q || 11 === q || 15 === q)) {
                  var r = m.alternate;
                  r ? (m.updateQueue = r.updateQueue, m.memoizedState = r.memoizedState, m.lanes = r.lanes) : (m.updateQueue = null, m.memoizedState = null);
                }
                var y = Ui(g);
                if (null !== y) {
                  y.flags &= -257;
                  Vi(y, g, h, f, b);
                  y.mode & 1 && Si(f, l, b);
                  b = y;
                  k = l;
                  var n = b.updateQueue;
                  if (null === n) {
                    var t3 = /* @__PURE__ */ new Set();
                    t3.add(k);
                    b.updateQueue = t3;
                  } else n.add(k);
                  break a;
                } else {
                  if (0 === (b & 1)) {
                    Si(f, l, b);
                    tj();
                    break a;
                  }
                  k = Error(p(426));
                }
              } else if (I && h.mode & 1) {
                var J = Ui(g);
                if (null !== J) {
                  0 === (J.flags & 65536) && (J.flags |= 256);
                  Vi(J, g, h, f, b);
                  Jg(Ji(k, h));
                  break a;
                }
              }
              f = k = Ji(k, h);
              4 !== T && (T = 2);
              null === sk ? sk = [f] : sk.push(f);
              f = g;
              do {
                switch (f.tag) {
                  case 3:
                    f.flags |= 65536;
                    b &= -b;
                    f.lanes |= b;
                    var x = Ni(f, k, b);
                    ph(f, x);
                    break a;
                  case 1:
                    h = k;
                    var w = f.type, u = f.stateNode;
                    if (0 === (f.flags & 128) && ("function" === typeof w.getDerivedStateFromError || null !== u && "function" === typeof u.componentDidCatch && (null === Ri || !Ri.has(u)))) {
                      f.flags |= 65536;
                      b &= -b;
                      f.lanes |= b;
                      var F = Qi(f, h, b);
                      ph(f, F);
                      break a;
                    }
                }
                f = f.return;
              } while (null !== f);
            }
            Sk(c);
          } catch (na) {
            b = na;
            Y === c && null !== c && (Y = c = c.return);
            continue;
          }
          break;
        } while (1);
      }
      function Jk() {
        var a = mk.current;
        mk.current = Rh;
        return null === a ? Rh : a;
      }
      function tj() {
        if (0 === T || 3 === T || 2 === T) T = 4;
        null === Q || 0 === (rh & 268435455) && 0 === (qk & 268435455) || Ck(Q, Z);
      }
      function Ik(a, b) {
        var c = K;
        K |= 2;
        var d = Jk();
        if (Q !== a || Z !== b) uk = null, Kk(a, b);
        do
          try {
            Tk();
            break;
          } catch (e) {
            Mk(a, e);
          }
        while (1);
        $g();
        K = c;
        mk.current = d;
        if (null !== Y) throw Error(p(261));
        Q = null;
        Z = 0;
        return T;
      }
      function Tk() {
        for (; null !== Y; ) Uk(Y);
      }
      function Lk() {
        for (; null !== Y && !cc(); ) Uk(Y);
      }
      function Uk(a) {
        var b = Vk(a.alternate, a, fj);
        a.memoizedProps = a.pendingProps;
        null === b ? Sk(a) : Y = b;
        nk.current = null;
      }
      function Sk(a) {
        var b = a;
        do {
          var c = b.alternate;
          a = b.return;
          if (0 === (b.flags & 32768)) {
            if (c = Ej(c, b, fj), null !== c) {
              Y = c;
              return;
            }
          } else {
            c = Ij(c, b);
            if (null !== c) {
              c.flags &= 32767;
              Y = c;
              return;
            }
            if (null !== a) a.flags |= 32768, a.subtreeFlags = 0, a.deletions = null;
            else {
              T = 6;
              Y = null;
              return;
            }
          }
          b = b.sibling;
          if (null !== b) {
            Y = b;
            return;
          }
          Y = b = a;
        } while (null !== b);
        0 === T && (T = 5);
      }
      function Pk(a, b, c) {
        var d = C, e = ok.transition;
        try {
          ok.transition = null, C = 1, Wk(a, b, c, d);
        } finally {
          ok.transition = e, C = d;
        }
        return null;
      }
      function Wk(a, b, c, d) {
        do
          Hk();
        while (null !== wk);
        if (0 !== (K & 6)) throw Error(p(327));
        c = a.finishedWork;
        var e = a.finishedLanes;
        if (null === c) return null;
        a.finishedWork = null;
        a.finishedLanes = 0;
        if (c === a.current) throw Error(p(177));
        a.callbackNode = null;
        a.callbackPriority = 0;
        var f = c.lanes | c.childLanes;
        Bc(a, f);
        a === Q && (Y = Q = null, Z = 0);
        0 === (c.subtreeFlags & 2064) && 0 === (c.flags & 2064) || vk || (vk = true, Fk(hc, function() {
          Hk();
          return null;
        }));
        f = 0 !== (c.flags & 15990);
        if (0 !== (c.subtreeFlags & 15990) || f) {
          f = ok.transition;
          ok.transition = null;
          var g = C;
          C = 1;
          var h = K;
          K |= 4;
          nk.current = null;
          Oj(a, c);
          dk(c, a);
          Oe(Df);
          dd = !!Cf;
          Df = Cf = null;
          a.current = c;
          hk(c, a, e);
          dc();
          K = h;
          C = g;
          ok.transition = f;
        } else a.current = c;
        vk && (vk = false, wk = a, xk = e);
        f = a.pendingLanes;
        0 === f && (Ri = null);
        mc(c.stateNode, d);
        Dk(a, B());
        if (null !== b) for (d = a.onRecoverableError, c = 0; c < b.length; c++) e = b[c], d(e.value, { componentStack: e.stack, digest: e.digest });
        if (Oi) throw Oi = false, a = Pi, Pi = null, a;
        0 !== (xk & 1) && 0 !== a.tag && Hk();
        f = a.pendingLanes;
        0 !== (f & 1) ? a === zk ? yk++ : (yk = 0, zk = a) : yk = 0;
        jg();
        return null;
      }
      function Hk() {
        if (null !== wk) {
          var a = Dc(xk), b = ok.transition, c = C;
          try {
            ok.transition = null;
            C = 16 > a ? 16 : a;
            if (null === wk) var d = false;
            else {
              a = wk;
              wk = null;
              xk = 0;
              if (0 !== (K & 6)) throw Error(p(331));
              var e = K;
              K |= 4;
              for (V = a.current; null !== V; ) {
                var f = V, g = f.child;
                if (0 !== (V.flags & 16)) {
                  var h = f.deletions;
                  if (null !== h) {
                    for (var k = 0; k < h.length; k++) {
                      var l = h[k];
                      for (V = l; null !== V; ) {
                        var m = V;
                        switch (m.tag) {
                          case 0:
                          case 11:
                          case 15:
                            Pj(8, m, f);
                        }
                        var q = m.child;
                        if (null !== q) q.return = m, V = q;
                        else for (; null !== V; ) {
                          m = V;
                          var r = m.sibling, y = m.return;
                          Sj(m);
                          if (m === l) {
                            V = null;
                            break;
                          }
                          if (null !== r) {
                            r.return = y;
                            V = r;
                            break;
                          }
                          V = y;
                        }
                      }
                    }
                    var n = f.alternate;
                    if (null !== n) {
                      var t3 = n.child;
                      if (null !== t3) {
                        n.child = null;
                        do {
                          var J = t3.sibling;
                          t3.sibling = null;
                          t3 = J;
                        } while (null !== t3);
                      }
                    }
                    V = f;
                  }
                }
                if (0 !== (f.subtreeFlags & 2064) && null !== g) g.return = f, V = g;
                else b: for (; null !== V; ) {
                  f = V;
                  if (0 !== (f.flags & 2048)) switch (f.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Pj(9, f, f.return);
                  }
                  var x = f.sibling;
                  if (null !== x) {
                    x.return = f.return;
                    V = x;
                    break b;
                  }
                  V = f.return;
                }
              }
              var w = a.current;
              for (V = w; null !== V; ) {
                g = V;
                var u = g.child;
                if (0 !== (g.subtreeFlags & 2064) && null !== u) u.return = g, V = u;
                else b: for (g = w; null !== V; ) {
                  h = V;
                  if (0 !== (h.flags & 2048)) try {
                    switch (h.tag) {
                      case 0:
                      case 11:
                      case 15:
                        Qj(9, h);
                    }
                  } catch (na) {
                    W(h, h.return, na);
                  }
                  if (h === g) {
                    V = null;
                    break b;
                  }
                  var F = h.sibling;
                  if (null !== F) {
                    F.return = h.return;
                    V = F;
                    break b;
                  }
                  V = h.return;
                }
              }
              K = e;
              jg();
              if (lc && "function" === typeof lc.onPostCommitFiberRoot) try {
                lc.onPostCommitFiberRoot(kc, a);
              } catch (na) {
              }
              d = true;
            }
            return d;
          } finally {
            C = c, ok.transition = b;
          }
        }
        return false;
      }
      function Xk(a, b, c) {
        b = Ji(c, b);
        b = Ni(a, b, 1);
        a = nh(a, b, 1);
        b = R();
        null !== a && (Ac(a, 1, b), Dk(a, b));
      }
      function W(a, b, c) {
        if (3 === a.tag) Xk(a, a, c);
        else for (; null !== b; ) {
          if (3 === b.tag) {
            Xk(b, a, c);
            break;
          } else if (1 === b.tag) {
            var d = b.stateNode;
            if ("function" === typeof b.type.getDerivedStateFromError || "function" === typeof d.componentDidCatch && (null === Ri || !Ri.has(d))) {
              a = Ji(c, a);
              a = Qi(b, a, 1);
              b = nh(b, a, 1);
              a = R();
              null !== b && (Ac(b, 1, a), Dk(b, a));
              break;
            }
          }
          b = b.return;
        }
      }
      function Ti(a, b, c) {
        var d = a.pingCache;
        null !== d && d.delete(b);
        b = R();
        a.pingedLanes |= a.suspendedLanes & c;
        Q === a && (Z & c) === c && (4 === T || 3 === T && (Z & 130023424) === Z && 500 > B() - fk ? Kk(a, 0) : rk |= c);
        Dk(a, b);
      }
      function Yk(a, b) {
        0 === b && (0 === (a.mode & 1) ? b = 1 : (b = sc, sc <<= 1, 0 === (sc & 130023424) && (sc = 4194304)));
        var c = R();
        a = ih(a, b);
        null !== a && (Ac(a, b, c), Dk(a, c));
      }
      function uj(a) {
        var b = a.memoizedState, c = 0;
        null !== b && (c = b.retryLane);
        Yk(a, c);
      }
      function bk(a, b) {
        var c = 0;
        switch (a.tag) {
          case 13:
            var d = a.stateNode;
            var e = a.memoizedState;
            null !== e && (c = e.retryLane);
            break;
          case 19:
            d = a.stateNode;
            break;
          default:
            throw Error(p(314));
        }
        null !== d && d.delete(b);
        Yk(a, c);
      }
      var Vk;
      Vk = function(a, b, c) {
        if (null !== a) if (a.memoizedProps !== b.pendingProps || Wf.current) dh = true;
        else {
          if (0 === (a.lanes & c) && 0 === (b.flags & 128)) return dh = false, yj(a, b, c);
          dh = 0 !== (a.flags & 131072) ? true : false;
        }
        else dh = false, I && 0 !== (b.flags & 1048576) && ug(b, ng, b.index);
        b.lanes = 0;
        switch (b.tag) {
          case 2:
            var d = b.type;
            ij(a, b);
            a = b.pendingProps;
            var e = Yf(b, H.current);
            ch(b, c);
            e = Nh(null, b, d, a, e, c);
            var f = Sh();
            b.flags |= 1;
            "object" === typeof e && null !== e && "function" === typeof e.render && void 0 === e.$$typeof ? (b.tag = 1, b.memoizedState = null, b.updateQueue = null, Zf(d) ? (f = true, cg(b)) : f = false, b.memoizedState = null !== e.state && void 0 !== e.state ? e.state : null, kh(b), e.updater = Ei, b.stateNode = e, e._reactInternals = b, Ii(b, d, a, c), b = jj(null, b, d, true, f, c)) : (b.tag = 0, I && f && vg(b), Xi(null, b, e, c), b = b.child);
            return b;
          case 16:
            d = b.elementType;
            a: {
              ij(a, b);
              a = b.pendingProps;
              e = d._init;
              d = e(d._payload);
              b.type = d;
              e = b.tag = Zk(d);
              a = Ci(d, a);
              switch (e) {
                case 0:
                  b = cj(null, b, d, a, c);
                  break a;
                case 1:
                  b = hj(null, b, d, a, c);
                  break a;
                case 11:
                  b = Yi(null, b, d, a, c);
                  break a;
                case 14:
                  b = $i(null, b, d, Ci(d.type, a), c);
                  break a;
              }
              throw Error(p(
                306,
                d,
                ""
              ));
            }
            return b;
          case 0:
            return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), cj(a, b, d, e, c);
          case 1:
            return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), hj(a, b, d, e, c);
          case 3:
            a: {
              kj(b);
              if (null === a) throw Error(p(387));
              d = b.pendingProps;
              f = b.memoizedState;
              e = f.element;
              lh(a, b);
              qh(b, d, null, c);
              var g = b.memoizedState;
              d = g.element;
              if (f.isDehydrated) if (f = { element: d, isDehydrated: false, cache: g.cache, pendingSuspenseBoundaries: g.pendingSuspenseBoundaries, transitions: g.transitions }, b.updateQueue.baseState = f, b.memoizedState = f, b.flags & 256) {
                e = Ji(Error(p(423)), b);
                b = lj(a, b, d, c, e);
                break a;
              } else if (d !== e) {
                e = Ji(Error(p(424)), b);
                b = lj(a, b, d, c, e);
                break a;
              } else for (yg = Lf(b.stateNode.containerInfo.firstChild), xg = b, I = true, zg = null, c = Vg(b, null, d, c), b.child = c; c; ) c.flags = c.flags & -3 | 4096, c = c.sibling;
              else {
                Ig();
                if (d === e) {
                  b = Zi(a, b, c);
                  break a;
                }
                Xi(a, b, d, c);
              }
              b = b.child;
            }
            return b;
          case 5:
            return Ah(b), null === a && Eg(b), d = b.type, e = b.pendingProps, f = null !== a ? a.memoizedProps : null, g = e.children, Ef(d, e) ? g = null : null !== f && Ef(d, f) && (b.flags |= 32), gj(a, b), Xi(a, b, g, c), b.child;
          case 6:
            return null === a && Eg(b), null;
          case 13:
            return oj(a, b, c);
          case 4:
            return yh(b, b.stateNode.containerInfo), d = b.pendingProps, null === a ? b.child = Ug(b, null, d, c) : Xi(a, b, d, c), b.child;
          case 11:
            return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), Yi(a, b, d, e, c);
          case 7:
            return Xi(a, b, b.pendingProps, c), b.child;
          case 8:
            return Xi(a, b, b.pendingProps.children, c), b.child;
          case 12:
            return Xi(a, b, b.pendingProps.children, c), b.child;
          case 10:
            a: {
              d = b.type._context;
              e = b.pendingProps;
              f = b.memoizedProps;
              g = e.value;
              G(Wg, d._currentValue);
              d._currentValue = g;
              if (null !== f) if (He(f.value, g)) {
                if (f.children === e.children && !Wf.current) {
                  b = Zi(a, b, c);
                  break a;
                }
              } else for (f = b.child, null !== f && (f.return = b); null !== f; ) {
                var h = f.dependencies;
                if (null !== h) {
                  g = f.child;
                  for (var k = h.firstContext; null !== k; ) {
                    if (k.context === d) {
                      if (1 === f.tag) {
                        k = mh(-1, c & -c);
                        k.tag = 2;
                        var l = f.updateQueue;
                        if (null !== l) {
                          l = l.shared;
                          var m = l.pending;
                          null === m ? k.next = k : (k.next = m.next, m.next = k);
                          l.pending = k;
                        }
                      }
                      f.lanes |= c;
                      k = f.alternate;
                      null !== k && (k.lanes |= c);
                      bh(
                        f.return,
                        c,
                        b
                      );
                      h.lanes |= c;
                      break;
                    }
                    k = k.next;
                  }
                } else if (10 === f.tag) g = f.type === b.type ? null : f.child;
                else if (18 === f.tag) {
                  g = f.return;
                  if (null === g) throw Error(p(341));
                  g.lanes |= c;
                  h = g.alternate;
                  null !== h && (h.lanes |= c);
                  bh(g, c, b);
                  g = f.sibling;
                } else g = f.child;
                if (null !== g) g.return = f;
                else for (g = f; null !== g; ) {
                  if (g === b) {
                    g = null;
                    break;
                  }
                  f = g.sibling;
                  if (null !== f) {
                    f.return = g.return;
                    g = f;
                    break;
                  }
                  g = g.return;
                }
                f = g;
              }
              Xi(a, b, e.children, c);
              b = b.child;
            }
            return b;
          case 9:
            return e = b.type, d = b.pendingProps.children, ch(b, c), e = eh(e), d = d(e), b.flags |= 1, Xi(a, b, d, c), b.child;
          case 14:
            return d = b.type, e = Ci(d, b.pendingProps), e = Ci(d.type, e), $i(a, b, d, e, c);
          case 15:
            return bj(a, b, b.type, b.pendingProps, c);
          case 17:
            return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), ij(a, b), b.tag = 1, Zf(d) ? (a = true, cg(b)) : a = false, ch(b, c), Gi(b, d, e), Ii(b, d, e, c), jj(null, b, d, true, a, c);
          case 19:
            return xj(a, b, c);
          case 22:
            return dj(a, b, c);
        }
        throw Error(p(156, b.tag));
      };
      function Fk(a, b) {
        return ac(a, b);
      }
      function $k(a, b, c, d) {
        this.tag = a;
        this.key = c;
        this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
        this.index = 0;
        this.ref = null;
        this.pendingProps = b;
        this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
        this.mode = d;
        this.subtreeFlags = this.flags = 0;
        this.deletions = null;
        this.childLanes = this.lanes = 0;
        this.alternate = null;
      }
      function Bg(a, b, c, d) {
        return new $k(a, b, c, d);
      }
      function aj(a) {
        a = a.prototype;
        return !(!a || !a.isReactComponent);
      }
      function Zk(a) {
        if ("function" === typeof a) return aj(a) ? 1 : 0;
        if (void 0 !== a && null !== a) {
          a = a.$$typeof;
          if (a === Da) return 11;
          if (a === Ga) return 14;
        }
        return 2;
      }
      function Pg(a, b) {
        var c = a.alternate;
        null === c ? (c = Bg(a.tag, b, a.key, a.mode), c.elementType = a.elementType, c.type = a.type, c.stateNode = a.stateNode, c.alternate = a, a.alternate = c) : (c.pendingProps = b, c.type = a.type, c.flags = 0, c.subtreeFlags = 0, c.deletions = null);
        c.flags = a.flags & 14680064;
        c.childLanes = a.childLanes;
        c.lanes = a.lanes;
        c.child = a.child;
        c.memoizedProps = a.memoizedProps;
        c.memoizedState = a.memoizedState;
        c.updateQueue = a.updateQueue;
        b = a.dependencies;
        c.dependencies = null === b ? null : { lanes: b.lanes, firstContext: b.firstContext };
        c.sibling = a.sibling;
        c.index = a.index;
        c.ref = a.ref;
        return c;
      }
      function Rg(a, b, c, d, e, f) {
        var g = 2;
        d = a;
        if ("function" === typeof a) aj(a) && (g = 1);
        else if ("string" === typeof a) g = 5;
        else a: switch (a) {
          case ya:
            return Tg(c.children, e, f, b);
          case za:
            g = 8;
            e |= 8;
            break;
          case Aa:
            return a = Bg(12, c, b, e | 2), a.elementType = Aa, a.lanes = f, a;
          case Ea:
            return a = Bg(13, c, b, e), a.elementType = Ea, a.lanes = f, a;
          case Fa:
            return a = Bg(19, c, b, e), a.elementType = Fa, a.lanes = f, a;
          case Ia:
            return pj(c, e, f, b);
          default:
            if ("object" === typeof a && null !== a) switch (a.$$typeof) {
              case Ba:
                g = 10;
                break a;
              case Ca:
                g = 9;
                break a;
              case Da:
                g = 11;
                break a;
              case Ga:
                g = 14;
                break a;
              case Ha:
                g = 16;
                d = null;
                break a;
            }
            throw Error(p(130, null == a ? a : typeof a, ""));
        }
        b = Bg(g, c, b, e);
        b.elementType = a;
        b.type = d;
        b.lanes = f;
        return b;
      }
      function Tg(a, b, c, d) {
        a = Bg(7, a, d, b);
        a.lanes = c;
        return a;
      }
      function pj(a, b, c, d) {
        a = Bg(22, a, d, b);
        a.elementType = Ia;
        a.lanes = c;
        a.stateNode = { isHidden: false };
        return a;
      }
      function Qg(a, b, c) {
        a = Bg(6, a, null, b);
        a.lanes = c;
        return a;
      }
      function Sg(a, b, c) {
        b = Bg(4, null !== a.children ? a.children : [], a.key, b);
        b.lanes = c;
        b.stateNode = { containerInfo: a.containerInfo, pendingChildren: null, implementation: a.implementation };
        return b;
      }
      function al(a, b, c, d, e) {
        this.tag = b;
        this.containerInfo = a;
        this.finishedWork = this.pingCache = this.current = this.pendingChildren = null;
        this.timeoutHandle = -1;
        this.callbackNode = this.pendingContext = this.context = null;
        this.callbackPriority = 0;
        this.eventTimes = zc(0);
        this.expirationTimes = zc(-1);
        this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
        this.entanglements = zc(0);
        this.identifierPrefix = d;
        this.onRecoverableError = e;
        this.mutableSourceEagerHydrationData = null;
      }
      function bl(a, b, c, d, e, f, g, h, k) {
        a = new al(a, b, c, h, k);
        1 === b ? (b = 1, true === f && (b |= 8)) : b = 0;
        f = Bg(3, null, null, b);
        a.current = f;
        f.stateNode = a;
        f.memoizedState = { element: d, isDehydrated: c, cache: null, transitions: null, pendingSuspenseBoundaries: null };
        kh(f);
        return a;
      }
      function cl(a, b, c) {
        var d = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
        return { $$typeof: wa, key: null == d ? null : "" + d, children: a, containerInfo: b, implementation: c };
      }
      function dl(a) {
        if (!a) return Vf;
        a = a._reactInternals;
        a: {
          if (Vb(a) !== a || 1 !== a.tag) throw Error(p(170));
          var b = a;
          do {
            switch (b.tag) {
              case 3:
                b = b.stateNode.context;
                break a;
              case 1:
                if (Zf(b.type)) {
                  b = b.stateNode.__reactInternalMemoizedMergedChildContext;
                  break a;
                }
            }
            b = b.return;
          } while (null !== b);
          throw Error(p(171));
        }
        if (1 === a.tag) {
          var c = a.type;
          if (Zf(c)) return bg(a, c, b);
        }
        return b;
      }
      function el(a, b, c, d, e, f, g, h, k) {
        a = bl(c, d, true, a, e, f, g, h, k);
        a.context = dl(null);
        c = a.current;
        d = R();
        e = yi(c);
        f = mh(d, e);
        f.callback = void 0 !== b && null !== b ? b : null;
        nh(c, f, e);
        a.current.lanes = e;
        Ac(a, e, d);
        Dk(a, d);
        return a;
      }
      function fl(a, b, c, d) {
        var e = b.current, f = R(), g = yi(e);
        c = dl(c);
        null === b.context ? b.context = c : b.pendingContext = c;
        b = mh(f, g);
        b.payload = { element: a };
        d = void 0 === d ? null : d;
        null !== d && (b.callback = d);
        a = nh(e, b, g);
        null !== a && (gi(a, e, g, f), oh(a, e, g));
        return g;
      }
      function gl(a) {
        a = a.current;
        if (!a.child) return null;
        switch (a.child.tag) {
          case 5:
            return a.child.stateNode;
          default:
            return a.child.stateNode;
        }
      }
      function hl(a, b) {
        a = a.memoizedState;
        if (null !== a && null !== a.dehydrated) {
          var c = a.retryLane;
          a.retryLane = 0 !== c && c < b ? c : b;
        }
      }
      function il(a, b) {
        hl(a, b);
        (a = a.alternate) && hl(a, b);
      }
      function jl() {
        return null;
      }
      var kl = "function" === typeof reportError ? reportError : function(a) {
        console.error(a);
      };
      function ll(a) {
        this._internalRoot = a;
      }
      ml.prototype.render = ll.prototype.render = function(a) {
        var b = this._internalRoot;
        if (null === b) throw Error(p(409));
        fl(a, b, null, null);
      };
      ml.prototype.unmount = ll.prototype.unmount = function() {
        var a = this._internalRoot;
        if (null !== a) {
          this._internalRoot = null;
          var b = a.containerInfo;
          Rk(function() {
            fl(null, a, null, null);
          });
          b[uf] = null;
        }
      };
      function ml(a) {
        this._internalRoot = a;
      }
      ml.prototype.unstable_scheduleHydration = function(a) {
        if (a) {
          var b = Hc();
          a = { blockedOn: null, target: a, priority: b };
          for (var c = 0; c < Qc.length && 0 !== b && b < Qc[c].priority; c++) ;
          Qc.splice(c, 0, a);
          0 === c && Vc(a);
        }
      };
      function nl(a) {
        return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType);
      }
      function ol(a) {
        return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType && (8 !== a.nodeType || " react-mount-point-unstable " !== a.nodeValue));
      }
      function pl() {
      }
      function ql(a, b, c, d, e) {
        if (e) {
          if ("function" === typeof d) {
            var f = d;
            d = function() {
              var a2 = gl(g);
              f.call(a2);
            };
          }
          var g = el(b, d, a, 0, null, false, false, "", pl);
          a._reactRootContainer = g;
          a[uf] = g.current;
          sf(8 === a.nodeType ? a.parentNode : a);
          Rk();
          return g;
        }
        for (; e = a.lastChild; ) a.removeChild(e);
        if ("function" === typeof d) {
          var h = d;
          d = function() {
            var a2 = gl(k);
            h.call(a2);
          };
        }
        var k = bl(a, 0, false, null, null, false, false, "", pl);
        a._reactRootContainer = k;
        a[uf] = k.current;
        sf(8 === a.nodeType ? a.parentNode : a);
        Rk(function() {
          fl(b, k, c, d);
        });
        return k;
      }
      function rl(a, b, c, d, e) {
        var f = c._reactRootContainer;
        if (f) {
          var g = f;
          if ("function" === typeof e) {
            var h = e;
            e = function() {
              var a2 = gl(g);
              h.call(a2);
            };
          }
          fl(b, g, a, e);
        } else g = ql(c, b, a, e, d);
        return gl(g);
      }
      Ec = function(a) {
        switch (a.tag) {
          case 3:
            var b = a.stateNode;
            if (b.current.memoizedState.isDehydrated) {
              var c = tc(b.pendingLanes);
              0 !== c && (Cc(b, c | 1), Dk(b, B()), 0 === (K & 6) && (Gj = B() + 500, jg()));
            }
            break;
          case 13:
            Rk(function() {
              var b2 = ih(a, 1);
              if (null !== b2) {
                var c2 = R();
                gi(b2, a, 1, c2);
              }
            }), il(a, 1);
        }
      };
      Fc = function(a) {
        if (13 === a.tag) {
          var b = ih(a, 134217728);
          if (null !== b) {
            var c = R();
            gi(b, a, 134217728, c);
          }
          il(a, 134217728);
        }
      };
      Gc = function(a) {
        if (13 === a.tag) {
          var b = yi(a), c = ih(a, b);
          if (null !== c) {
            var d = R();
            gi(c, a, b, d);
          }
          il(a, b);
        }
      };
      Hc = function() {
        return C;
      };
      Ic = function(a, b) {
        var c = C;
        try {
          return C = a, b();
        } finally {
          C = c;
        }
      };
      yb = function(a, b, c) {
        switch (b) {
          case "input":
            bb(a, c);
            b = c.name;
            if ("radio" === c.type && null != b) {
              for (c = a; c.parentNode; ) c = c.parentNode;
              c = c.querySelectorAll("input[name=" + JSON.stringify("" + b) + '][type="radio"]');
              for (b = 0; b < c.length; b++) {
                var d = c[b];
                if (d !== a && d.form === a.form) {
                  var e = Db(d);
                  if (!e) throw Error(p(90));
                  Wa(d);
                  bb(d, e);
                }
              }
            }
            break;
          case "textarea":
            ib(a, c);
            break;
          case "select":
            b = c.value, null != b && fb(a, !!c.multiple, b, false);
        }
      };
      Gb = Qk;
      Hb = Rk;
      var sl = { usingClientEntryPoint: false, Events: [Cb, ue, Db, Eb, Fb, Qk] };
      var tl = { findFiberByHostInstance: Wc, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" };
      var ul = { bundleType: tl.bundleType, version: tl.version, rendererPackageName: tl.rendererPackageName, rendererConfig: tl.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ua.ReactCurrentDispatcher, findHostInstanceByFiber: function(a) {
        a = Zb(a);
        return null === a ? null : a.stateNode;
      }, findFiberByHostInstance: tl.findFiberByHostInstance || jl, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
      if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
        vl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!vl.isDisabled && vl.supportsFiber) try {
          kc = vl.inject(ul), lc = vl;
        } catch (a) {
        }
      }
      var vl;
      exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = sl;
      exports.createPortal = function(a, b) {
        var c = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
        if (!nl(b)) throw Error(p(200));
        return cl(a, b, null, c);
      };
      exports.createRoot = function(a, b) {
        if (!nl(a)) throw Error(p(299));
        var c = false, d = "", e = kl;
        null !== b && void 0 !== b && (true === b.unstable_strictMode && (c = true), void 0 !== b.identifierPrefix && (d = b.identifierPrefix), void 0 !== b.onRecoverableError && (e = b.onRecoverableError));
        b = bl(a, 1, false, null, null, c, false, d, e);
        a[uf] = b.current;
        sf(8 === a.nodeType ? a.parentNode : a);
        return new ll(b);
      };
      exports.findDOMNode = function(a) {
        if (null == a) return null;
        if (1 === a.nodeType) return a;
        var b = a._reactInternals;
        if (void 0 === b) {
          if ("function" === typeof a.render) throw Error(p(188));
          a = Object.keys(a).join(",");
          throw Error(p(268, a));
        }
        a = Zb(b);
        a = null === a ? null : a.stateNode;
        return a;
      };
      exports.flushSync = function(a) {
        return Rk(a);
      };
      exports.hydrate = function(a, b, c) {
        if (!ol(b)) throw Error(p(200));
        return rl(null, a, b, true, c);
      };
      exports.hydrateRoot = function(a, b, c) {
        if (!nl(a)) throw Error(p(405));
        var d = null != c && c.hydratedSources || null, e = false, f = "", g = kl;
        null !== c && void 0 !== c && (true === c.unstable_strictMode && (e = true), void 0 !== c.identifierPrefix && (f = c.identifierPrefix), void 0 !== c.onRecoverableError && (g = c.onRecoverableError));
        b = el(b, null, a, 1, null != c ? c : null, e, false, f, g);
        a[uf] = b.current;
        sf(a);
        if (d) for (a = 0; a < d.length; a++) c = d[a], e = c._getVersion, e = e(c._source), null == b.mutableSourceEagerHydrationData ? b.mutableSourceEagerHydrationData = [c, e] : b.mutableSourceEagerHydrationData.push(
          c,
          e
        );
        return new ml(b);
      };
      exports.render = function(a, b, c) {
        if (!ol(b)) throw Error(p(200));
        return rl(null, a, b, false, c);
      };
      exports.unmountComponentAtNode = function(a) {
        if (!ol(a)) throw Error(p(40));
        return a._reactRootContainer ? (Rk(function() {
          rl(null, null, a, false, function() {
            a._reactRootContainer = null;
            a[uf] = null;
          });
        }), true) : false;
      };
      exports.unstable_batchedUpdates = Qk;
      exports.unstable_renderSubtreeIntoContainer = function(a, b, c, d) {
        if (!ol(c)) throw Error(p(200));
        if (null == a || void 0 === a._reactInternals) throw Error(p(38));
        return rl(a, b, c, false, d);
      };
      exports.version = "18.3.1-next-f1338f8080-20240426";
    }
  });

  // node_modules/react-dom/index.js
  var require_react_dom = __commonJS({
    "node_modules/react-dom/index.js"(exports, module) {
      "use strict";
      function checkDCE() {
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
          return;
        }
        if (false) {
          throw new Error("^_^");
        }
        try {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
        } catch (err) {
          console.error(err);
        }
      }
      if (true) {
        checkDCE();
        module.exports = require_react_dom_production_min();
      } else {
        module.exports = null;
      }
    }
  });

  // node_modules/react-dom/client.js
  var require_client = __commonJS({
    "node_modules/react-dom/client.js"(exports) {
      "use strict";
      var m = require_react_dom();
      if (true) {
        exports.createRoot = m.createRoot;
        exports.hydrateRoot = m.hydrateRoot;
      } else {
        i = m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
        exports.createRoot = function(c, o) {
          i.usingClientEntryPoint = true;
          try {
            return m.createRoot(c, o);
          } finally {
            i.usingClientEntryPoint = false;
          }
        };
        exports.hydrateRoot = function(c, h, o) {
          i.usingClientEntryPoint = true;
          try {
            return m.hydrateRoot(c, h, o);
          } finally {
            i.usingClientEntryPoint = false;
          }
        };
      }
      var i;
    }
  });

  // node_modules/void-elements/index.js
  var require_void_elements = __commonJS({
    "node_modules/void-elements/index.js"(exports, module) {
      module.exports = {
        "area": true,
        "base": true,
        "br": true,
        "col": true,
        "embed": true,
        "hr": true,
        "img": true,
        "input": true,
        "link": true,
        "meta": true,
        "param": true,
        "source": true,
        "track": true,
        "wbr": true
      };
    }
  });

  // node_modules/react/cjs/react-jsx-runtime.production.min.js
  var require_react_jsx_runtime_production_min = __commonJS({
    "node_modules/react/cjs/react-jsx-runtime.production.min.js"(exports) {
      "use strict";
      var f = require_react();
      var k = Symbol.for("react.element");
      var l = Symbol.for("react.fragment");
      var m = Object.prototype.hasOwnProperty;
      var n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner;
      var p = { key: true, ref: true, __self: true, __source: true };
      function q(c, a, g) {
        var b, d = {}, e = null, h = null;
        void 0 !== g && (e = "" + g);
        void 0 !== a.key && (e = "" + a.key);
        void 0 !== a.ref && (h = a.ref);
        for (b in a) m.call(a, b) && !p.hasOwnProperty(b) && (d[b] = a[b]);
        if (c && c.defaultProps) for (b in a = c.defaultProps, a) void 0 === d[b] && (d[b] = a[b]);
        return { $$typeof: k, type: c, key: e, ref: h, props: d, _owner: n.current };
      }
      exports.Fragment = l;
      exports.jsx = q;
      exports.jsxs = q;
    }
  });

  // node_modules/react/jsx-runtime.js
  var require_jsx_runtime = __commonJS({
    "node_modules/react/jsx-runtime.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_react_jsx_runtime_production_min();
      } else {
        module.exports = null;
      }
    }
  });

  // tools/preview/preview.tsx
  var import_client = __toESM(require_client());

  // node_modules/i18next/dist/esm/i18next.js
  var isString = (obj) => typeof obj === "string";
  var defer = () => {
    let res;
    let rej;
    const promise = new Promise((resolve, reject) => {
      res = resolve;
      rej = reject;
    });
    promise.resolve = res;
    promise.reject = rej;
    return promise;
  };
  var makeString = (object) => {
    if (object == null) return "";
    return "" + object;
  };
  var copy = (a, s, t3) => {
    a.forEach((m) => {
      if (s[m]) t3[m] = s[m];
    });
  };
  var lastOfPathSeparatorRegExp = /###/g;
  var cleanKey = (key) => key && key.indexOf("###") > -1 ? key.replace(lastOfPathSeparatorRegExp, ".") : key;
  var canNotTraverseDeeper = (object) => !object || isString(object);
  var getLastOfPath = (object, path, Empty) => {
    const stack = !isString(path) ? path : path.split(".");
    let stackIndex = 0;
    while (stackIndex < stack.length - 1) {
      if (canNotTraverseDeeper(object)) return {};
      const key = cleanKey(stack[stackIndex]);
      if (!object[key] && Empty) object[key] = new Empty();
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        object = object[key];
      } else {
        object = {};
      }
      ++stackIndex;
    }
    if (canNotTraverseDeeper(object)) return {};
    return {
      obj: object,
      k: cleanKey(stack[stackIndex])
    };
  };
  var setPath = (object, path, newValue) => {
    const {
      obj,
      k
    } = getLastOfPath(object, path, Object);
    if (obj !== void 0 || path.length === 1) {
      obj[k] = newValue;
      return;
    }
    let e = path[path.length - 1];
    let p = path.slice(0, path.length - 1);
    let last = getLastOfPath(object, p, Object);
    while (last.obj === void 0 && p.length) {
      e = `${p[p.length - 1]}.${e}`;
      p = p.slice(0, p.length - 1);
      last = getLastOfPath(object, p, Object);
      if (last && last.obj && typeof last.obj[`${last.k}.${e}`] !== "undefined") {
        last.obj = void 0;
      }
    }
    last.obj[`${last.k}.${e}`] = newValue;
  };
  var pushPath = (object, path, newValue, concat) => {
    const {
      obj,
      k
    } = getLastOfPath(object, path, Object);
    obj[k] = obj[k] || [];
    obj[k].push(newValue);
  };
  var getPath = (object, path) => {
    const {
      obj,
      k
    } = getLastOfPath(object, path);
    if (!obj) return void 0;
    return obj[k];
  };
  var getPathWithDefaults = (data, defaultData, key) => {
    const value = getPath(data, key);
    if (value !== void 0) {
      return value;
    }
    return getPath(defaultData, key);
  };
  var deepExtend = (target, source, overwrite) => {
    for (const prop in source) {
      if (prop !== "__proto__" && prop !== "constructor") {
        if (prop in target) {
          if (isString(target[prop]) || target[prop] instanceof String || isString(source[prop]) || source[prop] instanceof String) {
            if (overwrite) target[prop] = source[prop];
          } else {
            deepExtend(target[prop], source[prop], overwrite);
          }
        } else {
          target[prop] = source[prop];
        }
      }
    }
    return target;
  };
  var regexEscape = (str) => str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  var _entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;"
  };
  var escape = (data) => {
    if (isString(data)) {
      return data.replace(/[&<>"'\/]/g, (s) => _entityMap[s]);
    }
    return data;
  };
  var RegExpCache = class {
    constructor(capacity) {
      this.capacity = capacity;
      this.regExpMap = /* @__PURE__ */ new Map();
      this.regExpQueue = [];
    }
    getRegExp(pattern) {
      const regExpFromCache = this.regExpMap.get(pattern);
      if (regExpFromCache !== void 0) {
        return regExpFromCache;
      }
      const regExpNew = new RegExp(pattern);
      if (this.regExpQueue.length === this.capacity) {
        this.regExpMap.delete(this.regExpQueue.shift());
      }
      this.regExpMap.set(pattern, regExpNew);
      this.regExpQueue.push(pattern);
      return regExpNew;
    }
  };
  var chars = [" ", ",", "?", "!", ";"];
  var looksLikeObjectPathRegExpCache = new RegExpCache(20);
  var looksLikeObjectPath = (key, nsSeparator, keySeparator) => {
    nsSeparator = nsSeparator || "";
    keySeparator = keySeparator || "";
    const possibleChars = chars.filter((c) => nsSeparator.indexOf(c) < 0 && keySeparator.indexOf(c) < 0);
    if (possibleChars.length === 0) return true;
    const r = looksLikeObjectPathRegExpCache.getRegExp(`(${possibleChars.map((c) => c === "?" ? "\\?" : c).join("|")})`);
    let matched = !r.test(key);
    if (!matched) {
      const ki = key.indexOf(keySeparator);
      if (ki > 0 && !r.test(key.substring(0, ki))) {
        matched = true;
      }
    }
    return matched;
  };
  var deepFind = function(obj, path) {
    let keySeparator = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : ".";
    if (!obj) return void 0;
    if (obj[path]) return obj[path];
    const tokens = path.split(keySeparator);
    let current = obj;
    for (let i = 0; i < tokens.length; ) {
      if (!current || typeof current !== "object") {
        return void 0;
      }
      let next;
      let nextPath = "";
      for (let j = i; j < tokens.length; ++j) {
        if (j !== i) {
          nextPath += keySeparator;
        }
        nextPath += tokens[j];
        next = current[nextPath];
        if (next !== void 0) {
          if (["string", "number", "boolean"].indexOf(typeof next) > -1 && j < tokens.length - 1) {
            continue;
          }
          i += j - i + 1;
          break;
        }
      }
      current = next;
    }
    return current;
  };
  var getCleanedCode = (code) => code && code.replace("_", "-");
  var consoleLogger = {
    type: "logger",
    log(args) {
      this.output("log", args);
    },
    warn(args) {
      this.output("warn", args);
    },
    error(args) {
      this.output("error", args);
    },
    output(type, args) {
      if (console && console[type]) console[type].apply(console, args);
    }
  };
  var Logger = class _Logger {
    constructor(concreteLogger) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      this.init(concreteLogger, options);
    }
    init(concreteLogger) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      this.prefix = options.prefix || "i18next:";
      this.logger = concreteLogger || consoleLogger;
      this.options = options;
      this.debug = options.debug;
    }
    log() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return this.forward(args, "log", "", true);
    }
    warn() {
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }
      return this.forward(args, "warn", "", true);
    }
    error() {
      for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        args[_key3] = arguments[_key3];
      }
      return this.forward(args, "error", "");
    }
    deprecate() {
      for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
        args[_key4] = arguments[_key4];
      }
      return this.forward(args, "warn", "WARNING DEPRECATED: ", true);
    }
    forward(args, lvl, prefix, debugOnly) {
      if (debugOnly && !this.debug) return null;
      if (isString(args[0])) args[0] = `${prefix}${this.prefix} ${args[0]}`;
      return this.logger[lvl](args);
    }
    create(moduleName) {
      return new _Logger(this.logger, {
        ...{
          prefix: `${this.prefix}:${moduleName}:`
        },
        ...this.options
      });
    }
    clone(options) {
      options = options || this.options;
      options.prefix = options.prefix || this.prefix;
      return new _Logger(this.logger, options);
    }
  };
  var baseLogger = new Logger();
  var EventEmitter = class {
    constructor() {
      this.observers = {};
    }
    on(events, listener) {
      events.split(" ").forEach((event) => {
        if (!this.observers[event]) this.observers[event] = /* @__PURE__ */ new Map();
        const numListeners = this.observers[event].get(listener) || 0;
        this.observers[event].set(listener, numListeners + 1);
      });
      return this;
    }
    off(event, listener) {
      if (!this.observers[event]) return;
      if (!listener) {
        delete this.observers[event];
        return;
      }
      this.observers[event].delete(listener);
    }
    emit(event) {
      for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }
      if (this.observers[event]) {
        const cloned = Array.from(this.observers[event].entries());
        cloned.forEach((_ref) => {
          let [observer, numTimesAdded] = _ref;
          for (let i = 0; i < numTimesAdded; i++) {
            observer(...args);
          }
        });
      }
      if (this.observers["*"]) {
        const cloned = Array.from(this.observers["*"].entries());
        cloned.forEach((_ref2) => {
          let [observer, numTimesAdded] = _ref2;
          for (let i = 0; i < numTimesAdded; i++) {
            observer.apply(observer, [event, ...args]);
          }
        });
      }
    }
  };
  var ResourceStore = class extends EventEmitter {
    constructor(data) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
        ns: ["translation"],
        defaultNS: "translation"
      };
      super();
      this.data = data || {};
      this.options = options;
      if (this.options.keySeparator === void 0) {
        this.options.keySeparator = ".";
      }
      if (this.options.ignoreJSONStructure === void 0) {
        this.options.ignoreJSONStructure = true;
      }
    }
    addNamespaces(ns) {
      if (this.options.ns.indexOf(ns) < 0) {
        this.options.ns.push(ns);
      }
    }
    removeNamespaces(ns) {
      const index = this.options.ns.indexOf(ns);
      if (index > -1) {
        this.options.ns.splice(index, 1);
      }
    }
    getResource(lng, ns, key) {
      let options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
      const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
      const ignoreJSONStructure = options.ignoreJSONStructure !== void 0 ? options.ignoreJSONStructure : this.options.ignoreJSONStructure;
      let path;
      if (lng.indexOf(".") > -1) {
        path = lng.split(".");
      } else {
        path = [lng, ns];
        if (key) {
          if (Array.isArray(key)) {
            path.push(...key);
          } else if (isString(key) && keySeparator) {
            path.push(...key.split(keySeparator));
          } else {
            path.push(key);
          }
        }
      }
      const result = getPath(this.data, path);
      if (!result && !ns && !key && lng.indexOf(".") > -1) {
        lng = path[0];
        ns = path[1];
        key = path.slice(2).join(".");
      }
      if (result || !ignoreJSONStructure || !isString(key)) return result;
      return deepFind(this.data && this.data[lng] && this.data[lng][ns], key, keySeparator);
    }
    addResource(lng, ns, key, value) {
      let options = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : {
        silent: false
      };
      const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
      let path = [lng, ns];
      if (key) path = path.concat(keySeparator ? key.split(keySeparator) : key);
      if (lng.indexOf(".") > -1) {
        path = lng.split(".");
        value = ns;
        ns = path[1];
      }
      this.addNamespaces(ns);
      setPath(this.data, path, value);
      if (!options.silent) this.emit("added", lng, ns, key, value);
    }
    addResources(lng, ns, resources) {
      let options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {
        silent: false
      };
      for (const m in resources) {
        if (isString(resources[m]) || Array.isArray(resources[m])) this.addResource(lng, ns, m, resources[m], {
          silent: true
        });
      }
      if (!options.silent) this.emit("added", lng, ns, resources);
    }
    addResourceBundle(lng, ns, resources, deep, overwrite) {
      let options = arguments.length > 5 && arguments[5] !== void 0 ? arguments[5] : {
        silent: false,
        skipCopy: false
      };
      let path = [lng, ns];
      if (lng.indexOf(".") > -1) {
        path = lng.split(".");
        deep = resources;
        resources = ns;
        ns = path[1];
      }
      this.addNamespaces(ns);
      let pack = getPath(this.data, path) || {};
      if (!options.skipCopy) resources = JSON.parse(JSON.stringify(resources));
      if (deep) {
        deepExtend(pack, resources, overwrite);
      } else {
        pack = {
          ...pack,
          ...resources
        };
      }
      setPath(this.data, path, pack);
      if (!options.silent) this.emit("added", lng, ns, resources);
    }
    removeResourceBundle(lng, ns) {
      if (this.hasResourceBundle(lng, ns)) {
        delete this.data[lng][ns];
      }
      this.removeNamespaces(ns);
      this.emit("removed", lng, ns);
    }
    hasResourceBundle(lng, ns) {
      return this.getResource(lng, ns) !== void 0;
    }
    getResourceBundle(lng, ns) {
      if (!ns) ns = this.options.defaultNS;
      if (this.options.compatibilityAPI === "v1") return {
        ...{},
        ...this.getResource(lng, ns)
      };
      return this.getResource(lng, ns);
    }
    getDataByLanguage(lng) {
      return this.data[lng];
    }
    hasLanguageSomeTranslations(lng) {
      const data = this.getDataByLanguage(lng);
      const n = data && Object.keys(data) || [];
      return !!n.find((v) => data[v] && Object.keys(data[v]).length > 0);
    }
    toJSON() {
      return this.data;
    }
  };
  var postProcessor = {
    processors: {},
    addPostProcessor(module) {
      this.processors[module.name] = module;
    },
    handle(processors, value, key, options, translator) {
      processors.forEach((processor) => {
        if (this.processors[processor]) value = this.processors[processor].process(value, key, options, translator);
      });
      return value;
    }
  };
  var checkedLoadedFor = {};
  var Translator = class _Translator extends EventEmitter {
    constructor(services) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      super();
      copy(["resourceStore", "languageUtils", "pluralResolver", "interpolator", "backendConnector", "i18nFormat", "utils"], services, this);
      this.options = options;
      if (this.options.keySeparator === void 0) {
        this.options.keySeparator = ".";
      }
      this.logger = baseLogger.create("translator");
    }
    changeLanguage(lng) {
      if (lng) this.language = lng;
    }
    exists(key) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
        interpolation: {}
      };
      if (key === void 0 || key === null) {
        return false;
      }
      const resolved = this.resolve(key, options);
      return resolved && resolved.res !== void 0;
    }
    extractFromKey(key, options) {
      let nsSeparator = options.nsSeparator !== void 0 ? options.nsSeparator : this.options.nsSeparator;
      if (nsSeparator === void 0) nsSeparator = ":";
      const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
      let namespaces = options.ns || this.options.defaultNS || [];
      const wouldCheckForNsInKey = nsSeparator && key.indexOf(nsSeparator) > -1;
      const seemsNaturalLanguage = !this.options.userDefinedKeySeparator && !options.keySeparator && !this.options.userDefinedNsSeparator && !options.nsSeparator && !looksLikeObjectPath(key, nsSeparator, keySeparator);
      if (wouldCheckForNsInKey && !seemsNaturalLanguage) {
        const m = key.match(this.interpolator.nestingRegexp);
        if (m && m.length > 0) {
          return {
            key,
            namespaces: isString(namespaces) ? [namespaces] : namespaces
          };
        }
        const parts = key.split(nsSeparator);
        if (nsSeparator !== keySeparator || nsSeparator === keySeparator && this.options.ns.indexOf(parts[0]) > -1) namespaces = parts.shift();
        key = parts.join(keySeparator);
      }
      return {
        key,
        namespaces: isString(namespaces) ? [namespaces] : namespaces
      };
    }
    translate(keys, options, lastKey) {
      if (typeof options !== "object" && this.options.overloadTranslationOptionHandler) {
        options = this.options.overloadTranslationOptionHandler(arguments);
      }
      if (typeof options === "object") options = {
        ...options
      };
      if (!options) options = {};
      if (keys === void 0 || keys === null) return "";
      if (!Array.isArray(keys)) keys = [String(keys)];
      const returnDetails = options.returnDetails !== void 0 ? options.returnDetails : this.options.returnDetails;
      const keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
      const {
        key,
        namespaces
      } = this.extractFromKey(keys[keys.length - 1], options);
      const namespace = namespaces[namespaces.length - 1];
      const lng = options.lng || this.language;
      const appendNamespaceToCIMode = options.appendNamespaceToCIMode || this.options.appendNamespaceToCIMode;
      if (lng && lng.toLowerCase() === "cimode") {
        if (appendNamespaceToCIMode) {
          const nsSeparator = options.nsSeparator || this.options.nsSeparator;
          if (returnDetails) {
            return {
              res: `${namespace}${nsSeparator}${key}`,
              usedKey: key,
              exactUsedKey: key,
              usedLng: lng,
              usedNS: namespace,
              usedParams: this.getUsedParamsDetails(options)
            };
          }
          return `${namespace}${nsSeparator}${key}`;
        }
        if (returnDetails) {
          return {
            res: key,
            usedKey: key,
            exactUsedKey: key,
            usedLng: lng,
            usedNS: namespace,
            usedParams: this.getUsedParamsDetails(options)
          };
        }
        return key;
      }
      const resolved = this.resolve(keys, options);
      let res = resolved && resolved.res;
      const resUsedKey = resolved && resolved.usedKey || key;
      const resExactUsedKey = resolved && resolved.exactUsedKey || key;
      const resType = Object.prototype.toString.apply(res);
      const noObject = ["[object Number]", "[object Function]", "[object RegExp]"];
      const joinArrays = options.joinArrays !== void 0 ? options.joinArrays : this.options.joinArrays;
      const handleAsObjectInI18nFormat = !this.i18nFormat || this.i18nFormat.handleAsObject;
      const handleAsObject = !isString(res) && typeof res !== "boolean" && typeof res !== "number";
      if (handleAsObjectInI18nFormat && res && handleAsObject && noObject.indexOf(resType) < 0 && !(isString(joinArrays) && Array.isArray(res))) {
        if (!options.returnObjects && !this.options.returnObjects) {
          if (!this.options.returnedObjectHandler) {
            this.logger.warn("accessing an object - but returnObjects options is not enabled!");
          }
          const r = this.options.returnedObjectHandler ? this.options.returnedObjectHandler(resUsedKey, res, {
            ...options,
            ns: namespaces
          }) : `key '${key} (${this.language})' returned an object instead of string.`;
          if (returnDetails) {
            resolved.res = r;
            resolved.usedParams = this.getUsedParamsDetails(options);
            return resolved;
          }
          return r;
        }
        if (keySeparator) {
          const resTypeIsArray = Array.isArray(res);
          const copy2 = resTypeIsArray ? [] : {};
          const newKeyToUse = resTypeIsArray ? resExactUsedKey : resUsedKey;
          for (const m in res) {
            if (Object.prototype.hasOwnProperty.call(res, m)) {
              const deepKey = `${newKeyToUse}${keySeparator}${m}`;
              copy2[m] = this.translate(deepKey, {
                ...options,
                ...{
                  joinArrays: false,
                  ns: namespaces
                }
              });
              if (copy2[m] === deepKey) copy2[m] = res[m];
            }
          }
          res = copy2;
        }
      } else if (handleAsObjectInI18nFormat && isString(joinArrays) && Array.isArray(res)) {
        res = res.join(joinArrays);
        if (res) res = this.extendTranslation(res, keys, options, lastKey);
      } else {
        let usedDefault = false;
        let usedKey = false;
        const needsPluralHandling = options.count !== void 0 && !isString(options.count);
        const hasDefaultValue = _Translator.hasDefaultValue(options);
        const defaultValueSuffix = needsPluralHandling ? this.pluralResolver.getSuffix(lng, options.count, options) : "";
        const defaultValueSuffixOrdinalFallback = options.ordinal && needsPluralHandling ? this.pluralResolver.getSuffix(lng, options.count, {
          ordinal: false
        }) : "";
        const needsZeroSuffixLookup = needsPluralHandling && !options.ordinal && options.count === 0 && this.pluralResolver.shouldUseIntlApi();
        const defaultValue = needsZeroSuffixLookup && options[`defaultValue${this.options.pluralSeparator}zero`] || options[`defaultValue${defaultValueSuffix}`] || options[`defaultValue${defaultValueSuffixOrdinalFallback}`] || options.defaultValue;
        if (!this.isValidLookup(res) && hasDefaultValue) {
          usedDefault = true;
          res = defaultValue;
        }
        if (!this.isValidLookup(res)) {
          usedKey = true;
          res = key;
        }
        const missingKeyNoValueFallbackToKey = options.missingKeyNoValueFallbackToKey || this.options.missingKeyNoValueFallbackToKey;
        const resForMissing = missingKeyNoValueFallbackToKey && usedKey ? void 0 : res;
        const updateMissing = hasDefaultValue && defaultValue !== res && this.options.updateMissing;
        if (usedKey || usedDefault || updateMissing) {
          this.logger.log(updateMissing ? "updateKey" : "missingKey", lng, namespace, key, updateMissing ? defaultValue : res);
          if (keySeparator) {
            const fk = this.resolve(key, {
              ...options,
              keySeparator: false
            });
            if (fk && fk.res) this.logger.warn("Seems the loaded translations were in flat JSON format instead of nested. Either set keySeparator: false on init or make sure your translations are published in nested format.");
          }
          let lngs = [];
          const fallbackLngs = this.languageUtils.getFallbackCodes(this.options.fallbackLng, options.lng || this.language);
          if (this.options.saveMissingTo === "fallback" && fallbackLngs && fallbackLngs[0]) {
            for (let i = 0; i < fallbackLngs.length; i++) {
              lngs.push(fallbackLngs[i]);
            }
          } else if (this.options.saveMissingTo === "all") {
            lngs = this.languageUtils.toResolveHierarchy(options.lng || this.language);
          } else {
            lngs.push(options.lng || this.language);
          }
          const send = (l, k, specificDefaultValue) => {
            const defaultForMissing = hasDefaultValue && specificDefaultValue !== res ? specificDefaultValue : resForMissing;
            if (this.options.missingKeyHandler) {
              this.options.missingKeyHandler(l, namespace, k, defaultForMissing, updateMissing, options);
            } else if (this.backendConnector && this.backendConnector.saveMissing) {
              this.backendConnector.saveMissing(l, namespace, k, defaultForMissing, updateMissing, options);
            }
            this.emit("missingKey", l, namespace, k, res);
          };
          if (this.options.saveMissing) {
            if (this.options.saveMissingPlurals && needsPluralHandling) {
              lngs.forEach((language) => {
                const suffixes = this.pluralResolver.getSuffixes(language, options);
                if (needsZeroSuffixLookup && options[`defaultValue${this.options.pluralSeparator}zero`] && suffixes.indexOf(`${this.options.pluralSeparator}zero`) < 0) {
                  suffixes.push(`${this.options.pluralSeparator}zero`);
                }
                suffixes.forEach((suffix) => {
                  send([language], key + suffix, options[`defaultValue${suffix}`] || defaultValue);
                });
              });
            } else {
              send(lngs, key, defaultValue);
            }
          }
        }
        res = this.extendTranslation(res, keys, options, resolved, lastKey);
        if (usedKey && res === key && this.options.appendNamespaceToMissingKey) res = `${namespace}:${key}`;
        if ((usedKey || usedDefault) && this.options.parseMissingKeyHandler) {
          if (this.options.compatibilityAPI !== "v1") {
            res = this.options.parseMissingKeyHandler(this.options.appendNamespaceToMissingKey ? `${namespace}:${key}` : key, usedDefault ? res : void 0);
          } else {
            res = this.options.parseMissingKeyHandler(res);
          }
        }
      }
      if (returnDetails) {
        resolved.res = res;
        resolved.usedParams = this.getUsedParamsDetails(options);
        return resolved;
      }
      return res;
    }
    extendTranslation(res, key, options, resolved, lastKey) {
      var _this = this;
      if (this.i18nFormat && this.i18nFormat.parse) {
        res = this.i18nFormat.parse(res, {
          ...this.options.interpolation.defaultVariables,
          ...options
        }, options.lng || this.language || resolved.usedLng, resolved.usedNS, resolved.usedKey, {
          resolved
        });
      } else if (!options.skipInterpolation) {
        if (options.interpolation) this.interpolator.init({
          ...options,
          ...{
            interpolation: {
              ...this.options.interpolation,
              ...options.interpolation
            }
          }
        });
        const skipOnVariables = isString(res) && (options && options.interpolation && options.interpolation.skipOnVariables !== void 0 ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables);
        let nestBef;
        if (skipOnVariables) {
          const nb = res.match(this.interpolator.nestingRegexp);
          nestBef = nb && nb.length;
        }
        let data = options.replace && !isString(options.replace) ? options.replace : options;
        if (this.options.interpolation.defaultVariables) data = {
          ...this.options.interpolation.defaultVariables,
          ...data
        };
        res = this.interpolator.interpolate(res, data, options.lng || this.language || resolved.usedLng, options);
        if (skipOnVariables) {
          const na = res.match(this.interpolator.nestingRegexp);
          const nestAft = na && na.length;
          if (nestBef < nestAft) options.nest = false;
        }
        if (!options.lng && this.options.compatibilityAPI !== "v1" && resolved && resolved.res) options.lng = this.language || resolved.usedLng;
        if (options.nest !== false) res = this.interpolator.nest(res, function() {
          for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }
          if (lastKey && lastKey[0] === args[0] && !options.context) {
            _this.logger.warn(`It seems you are nesting recursively key: ${args[0]} in key: ${key[0]}`);
            return null;
          }
          return _this.translate(...args, key);
        }, options);
        if (options.interpolation) this.interpolator.reset();
      }
      const postProcess = options.postProcess || this.options.postProcess;
      const postProcessorNames = isString(postProcess) ? [postProcess] : postProcess;
      if (res !== void 0 && res !== null && postProcessorNames && postProcessorNames.length && options.applyPostProcessor !== false) {
        res = postProcessor.handle(postProcessorNames, res, key, this.options && this.options.postProcessPassResolved ? {
          i18nResolved: {
            ...resolved,
            usedParams: this.getUsedParamsDetails(options)
          },
          ...options
        } : options, this);
      }
      return res;
    }
    resolve(keys) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      let found;
      let usedKey;
      let exactUsedKey;
      let usedLng;
      let usedNS;
      if (isString(keys)) keys = [keys];
      keys.forEach((k) => {
        if (this.isValidLookup(found)) return;
        const extracted = this.extractFromKey(k, options);
        const key = extracted.key;
        usedKey = key;
        let namespaces = extracted.namespaces;
        if (this.options.fallbackNS) namespaces = namespaces.concat(this.options.fallbackNS);
        const needsPluralHandling = options.count !== void 0 && !isString(options.count);
        const needsZeroSuffixLookup = needsPluralHandling && !options.ordinal && options.count === 0 && this.pluralResolver.shouldUseIntlApi();
        const needsContextHandling = options.context !== void 0 && (isString(options.context) || typeof options.context === "number") && options.context !== "";
        const codes = options.lngs ? options.lngs : this.languageUtils.toResolveHierarchy(options.lng || this.language, options.fallbackLng);
        namespaces.forEach((ns) => {
          if (this.isValidLookup(found)) return;
          usedNS = ns;
          if (!checkedLoadedFor[`${codes[0]}-${ns}`] && this.utils && this.utils.hasLoadedNamespace && !this.utils.hasLoadedNamespace(usedNS)) {
            checkedLoadedFor[`${codes[0]}-${ns}`] = true;
            this.logger.warn(`key "${usedKey}" for languages "${codes.join(", ")}" won't get resolved as namespace "${usedNS}" was not yet loaded`, "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
          }
          codes.forEach((code) => {
            if (this.isValidLookup(found)) return;
            usedLng = code;
            const finalKeys = [key];
            if (this.i18nFormat && this.i18nFormat.addLookupKeys) {
              this.i18nFormat.addLookupKeys(finalKeys, key, code, ns, options);
            } else {
              let pluralSuffix;
              if (needsPluralHandling) pluralSuffix = this.pluralResolver.getSuffix(code, options.count, options);
              const zeroSuffix = `${this.options.pluralSeparator}zero`;
              const ordinalPrefix = `${this.options.pluralSeparator}ordinal${this.options.pluralSeparator}`;
              if (needsPluralHandling) {
                finalKeys.push(key + pluralSuffix);
                if (options.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                  finalKeys.push(key + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                }
                if (needsZeroSuffixLookup) {
                  finalKeys.push(key + zeroSuffix);
                }
              }
              if (needsContextHandling) {
                const contextKey = `${key}${this.options.contextSeparator}${options.context}`;
                finalKeys.push(contextKey);
                if (needsPluralHandling) {
                  finalKeys.push(contextKey + pluralSuffix);
                  if (options.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                    finalKeys.push(contextKey + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                  }
                  if (needsZeroSuffixLookup) {
                    finalKeys.push(contextKey + zeroSuffix);
                  }
                }
              }
            }
            let possibleKey;
            while (possibleKey = finalKeys.pop()) {
              if (!this.isValidLookup(found)) {
                exactUsedKey = possibleKey;
                found = this.getResource(code, ns, possibleKey, options);
              }
            }
          });
        });
      });
      return {
        res: found,
        usedKey,
        exactUsedKey,
        usedLng,
        usedNS
      };
    }
    isValidLookup(res) {
      return res !== void 0 && !(!this.options.returnNull && res === null) && !(!this.options.returnEmptyString && res === "");
    }
    getResource(code, ns, key) {
      let options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
      if (this.i18nFormat && this.i18nFormat.getResource) return this.i18nFormat.getResource(code, ns, key, options);
      return this.resourceStore.getResource(code, ns, key, options);
    }
    getUsedParamsDetails() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      const optionsKeys = ["defaultValue", "ordinal", "context", "replace", "lng", "lngs", "fallbackLng", "ns", "keySeparator", "nsSeparator", "returnObjects", "returnDetails", "joinArrays", "postProcess", "interpolation"];
      const useOptionsReplaceForData = options.replace && !isString(options.replace);
      let data = useOptionsReplaceForData ? options.replace : options;
      if (useOptionsReplaceForData && typeof options.count !== "undefined") {
        data.count = options.count;
      }
      if (this.options.interpolation.defaultVariables) {
        data = {
          ...this.options.interpolation.defaultVariables,
          ...data
        };
      }
      if (!useOptionsReplaceForData) {
        data = {
          ...data
        };
        for (const key of optionsKeys) {
          delete data[key];
        }
      }
      return data;
    }
    static hasDefaultValue(options) {
      const prefix = "defaultValue";
      for (const option in options) {
        if (Object.prototype.hasOwnProperty.call(options, option) && prefix === option.substring(0, prefix.length) && void 0 !== options[option]) {
          return true;
        }
      }
      return false;
    }
  };
  var capitalize = (string) => string.charAt(0).toUpperCase() + string.slice(1);
  var LanguageUtil = class {
    constructor(options) {
      this.options = options;
      this.supportedLngs = this.options.supportedLngs || false;
      this.logger = baseLogger.create("languageUtils");
    }
    getScriptPartFromCode(code) {
      code = getCleanedCode(code);
      if (!code || code.indexOf("-") < 0) return null;
      const p = code.split("-");
      if (p.length === 2) return null;
      p.pop();
      if (p[p.length - 1].toLowerCase() === "x") return null;
      return this.formatLanguageCode(p.join("-"));
    }
    getLanguagePartFromCode(code) {
      code = getCleanedCode(code);
      if (!code || code.indexOf("-") < 0) return code;
      const p = code.split("-");
      return this.formatLanguageCode(p[0]);
    }
    formatLanguageCode(code) {
      if (isString(code) && code.indexOf("-") > -1) {
        if (typeof Intl !== "undefined" && typeof Intl.getCanonicalLocales !== "undefined") {
          try {
            let formattedCode = Intl.getCanonicalLocales(code)[0];
            if (formattedCode && this.options.lowerCaseLng) {
              formattedCode = formattedCode.toLowerCase();
            }
            if (formattedCode) return formattedCode;
          } catch (e) {
          }
        }
        const specialCases = ["hans", "hant", "latn", "cyrl", "cans", "mong", "arab"];
        let p = code.split("-");
        if (this.options.lowerCaseLng) {
          p = p.map((part) => part.toLowerCase());
        } else if (p.length === 2) {
          p[0] = p[0].toLowerCase();
          p[1] = p[1].toUpperCase();
          if (specialCases.indexOf(p[1].toLowerCase()) > -1) p[1] = capitalize(p[1].toLowerCase());
        } else if (p.length === 3) {
          p[0] = p[0].toLowerCase();
          if (p[1].length === 2) p[1] = p[1].toUpperCase();
          if (p[0] !== "sgn" && p[2].length === 2) p[2] = p[2].toUpperCase();
          if (specialCases.indexOf(p[1].toLowerCase()) > -1) p[1] = capitalize(p[1].toLowerCase());
          if (specialCases.indexOf(p[2].toLowerCase()) > -1) p[2] = capitalize(p[2].toLowerCase());
        }
        return p.join("-");
      }
      return this.options.cleanCode || this.options.lowerCaseLng ? code.toLowerCase() : code;
    }
    isSupportedCode(code) {
      if (this.options.load === "languageOnly" || this.options.nonExplicitSupportedLngs) {
        code = this.getLanguagePartFromCode(code);
      }
      return !this.supportedLngs || !this.supportedLngs.length || this.supportedLngs.indexOf(code) > -1;
    }
    getBestMatchFromCodes(codes) {
      if (!codes) return null;
      let found;
      codes.forEach((code) => {
        if (found) return;
        const cleanedLng = this.formatLanguageCode(code);
        if (!this.options.supportedLngs || this.isSupportedCode(cleanedLng)) found = cleanedLng;
      });
      if (!found && this.options.supportedLngs) {
        codes.forEach((code) => {
          if (found) return;
          const lngOnly = this.getLanguagePartFromCode(code);
          if (this.isSupportedCode(lngOnly)) return found = lngOnly;
          found = this.options.supportedLngs.find((supportedLng) => {
            if (supportedLng === lngOnly) return supportedLng;
            if (supportedLng.indexOf("-") < 0 && lngOnly.indexOf("-") < 0) return;
            if (supportedLng.indexOf("-") > 0 && lngOnly.indexOf("-") < 0 && supportedLng.substring(0, supportedLng.indexOf("-")) === lngOnly) return supportedLng;
            if (supportedLng.indexOf(lngOnly) === 0 && lngOnly.length > 1) return supportedLng;
          });
        });
      }
      if (!found) found = this.getFallbackCodes(this.options.fallbackLng)[0];
      return found;
    }
    getFallbackCodes(fallbacks, code) {
      if (!fallbacks) return [];
      if (typeof fallbacks === "function") fallbacks = fallbacks(code);
      if (isString(fallbacks)) fallbacks = [fallbacks];
      if (Array.isArray(fallbacks)) return fallbacks;
      if (!code) return fallbacks.default || [];
      let found = fallbacks[code];
      if (!found) found = fallbacks[this.getScriptPartFromCode(code)];
      if (!found) found = fallbacks[this.formatLanguageCode(code)];
      if (!found) found = fallbacks[this.getLanguagePartFromCode(code)];
      if (!found) found = fallbacks.default;
      return found || [];
    }
    toResolveHierarchy(code, fallbackCode) {
      const fallbackCodes = this.getFallbackCodes(fallbackCode || this.options.fallbackLng || [], code);
      const codes = [];
      const addCode = (c) => {
        if (!c) return;
        if (this.isSupportedCode(c)) {
          codes.push(c);
        } else {
          this.logger.warn(`rejecting language code not found in supportedLngs: ${c}`);
        }
      };
      if (isString(code) && (code.indexOf("-") > -1 || code.indexOf("_") > -1)) {
        if (this.options.load !== "languageOnly") addCode(this.formatLanguageCode(code));
        if (this.options.load !== "languageOnly" && this.options.load !== "currentOnly") addCode(this.getScriptPartFromCode(code));
        if (this.options.load !== "currentOnly") addCode(this.getLanguagePartFromCode(code));
      } else if (isString(code)) {
        addCode(this.formatLanguageCode(code));
      }
      fallbackCodes.forEach((fc) => {
        if (codes.indexOf(fc) < 0) addCode(this.formatLanguageCode(fc));
      });
      return codes;
    }
  };
  var sets = [{
    lngs: ["ach", "ak", "am", "arn", "br", "fil", "gun", "ln", "mfe", "mg", "mi", "oc", "pt", "pt-BR", "tg", "tl", "ti", "tr", "uz", "wa"],
    nr: [1, 2],
    fc: 1
  }, {
    lngs: ["af", "an", "ast", "az", "bg", "bn", "ca", "da", "de", "dev", "el", "en", "eo", "es", "et", "eu", "fi", "fo", "fur", "fy", "gl", "gu", "ha", "hi", "hu", "hy", "ia", "it", "kk", "kn", "ku", "lb", "mai", "ml", "mn", "mr", "nah", "nap", "nb", "ne", "nl", "nn", "no", "nso", "pa", "pap", "pms", "ps", "pt-PT", "rm", "sco", "se", "si", "so", "son", "sq", "sv", "sw", "ta", "te", "tk", "ur", "yo"],
    nr: [1, 2],
    fc: 2
  }, {
    lngs: ["ay", "bo", "cgg", "fa", "ht", "id", "ja", "jbo", "ka", "km", "ko", "ky", "lo", "ms", "sah", "su", "th", "tt", "ug", "vi", "wo", "zh"],
    nr: [1],
    fc: 3
  }, {
    lngs: ["be", "bs", "cnr", "dz", "hr", "ru", "sr", "uk"],
    nr: [1, 2, 5],
    fc: 4
  }, {
    lngs: ["ar"],
    nr: [0, 1, 2, 3, 11, 100],
    fc: 5
  }, {
    lngs: ["cs", "sk"],
    nr: [1, 2, 5],
    fc: 6
  }, {
    lngs: ["csb", "pl"],
    nr: [1, 2, 5],
    fc: 7
  }, {
    lngs: ["cy"],
    nr: [1, 2, 3, 8],
    fc: 8
  }, {
    lngs: ["fr"],
    nr: [1, 2],
    fc: 9
  }, {
    lngs: ["ga"],
    nr: [1, 2, 3, 7, 11],
    fc: 10
  }, {
    lngs: ["gd"],
    nr: [1, 2, 3, 20],
    fc: 11
  }, {
    lngs: ["is"],
    nr: [1, 2],
    fc: 12
  }, {
    lngs: ["jv"],
    nr: [0, 1],
    fc: 13
  }, {
    lngs: ["kw"],
    nr: [1, 2, 3, 4],
    fc: 14
  }, {
    lngs: ["lt"],
    nr: [1, 2, 10],
    fc: 15
  }, {
    lngs: ["lv"],
    nr: [1, 2, 0],
    fc: 16
  }, {
    lngs: ["mk"],
    nr: [1, 2],
    fc: 17
  }, {
    lngs: ["mnk"],
    nr: [0, 1, 2],
    fc: 18
  }, {
    lngs: ["mt"],
    nr: [1, 2, 11, 20],
    fc: 19
  }, {
    lngs: ["or"],
    nr: [2, 1],
    fc: 2
  }, {
    lngs: ["ro"],
    nr: [1, 2, 20],
    fc: 20
  }, {
    lngs: ["sl"],
    nr: [5, 1, 2, 3],
    fc: 21
  }, {
    lngs: ["he", "iw"],
    nr: [1, 2, 20, 21],
    fc: 22
  }];
  var _rulesPluralsTypes = {
    1: (n) => Number(n > 1),
    2: (n) => Number(n != 1),
    3: (n) => 0,
    4: (n) => Number(n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2),
    5: (n) => Number(n == 0 ? 0 : n == 1 ? 1 : n == 2 ? 2 : n % 100 >= 3 && n % 100 <= 10 ? 3 : n % 100 >= 11 ? 4 : 5),
    6: (n) => Number(n == 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2),
    7: (n) => Number(n == 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2),
    8: (n) => Number(n == 1 ? 0 : n == 2 ? 1 : n != 8 && n != 11 ? 2 : 3),
    9: (n) => Number(n >= 2),
    10: (n) => Number(n == 1 ? 0 : n == 2 ? 1 : n < 7 ? 2 : n < 11 ? 3 : 4),
    11: (n) => Number(n == 1 || n == 11 ? 0 : n == 2 || n == 12 ? 1 : n > 2 && n < 20 ? 2 : 3),
    12: (n) => Number(n % 10 != 1 || n % 100 == 11),
    13: (n) => Number(n !== 0),
    14: (n) => Number(n == 1 ? 0 : n == 2 ? 1 : n == 3 ? 2 : 3),
    15: (n) => Number(n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2),
    16: (n) => Number(n % 10 == 1 && n % 100 != 11 ? 0 : n !== 0 ? 1 : 2),
    17: (n) => Number(n == 1 || n % 10 == 1 && n % 100 != 11 ? 0 : 1),
    18: (n) => Number(n == 0 ? 0 : n == 1 ? 1 : 2),
    19: (n) => Number(n == 1 ? 0 : n == 0 || n % 100 > 1 && n % 100 < 11 ? 1 : n % 100 > 10 && n % 100 < 20 ? 2 : 3),
    20: (n) => Number(n == 1 ? 0 : n == 0 || n % 100 > 0 && n % 100 < 20 ? 1 : 2),
    21: (n) => Number(n % 100 == 1 ? 1 : n % 100 == 2 ? 2 : n % 100 == 3 || n % 100 == 4 ? 3 : 0),
    22: (n) => Number(n == 1 ? 0 : n == 2 ? 1 : (n < 0 || n > 10) && n % 10 == 0 ? 2 : 3)
  };
  var nonIntlVersions = ["v1", "v2", "v3"];
  var intlVersions = ["v4"];
  var suffixesOrder = {
    zero: 0,
    one: 1,
    two: 2,
    few: 3,
    many: 4,
    other: 5
  };
  var createRules = () => {
    const rules = {};
    sets.forEach((set) => {
      set.lngs.forEach((l) => {
        rules[l] = {
          numbers: set.nr,
          plurals: _rulesPluralsTypes[set.fc]
        };
      });
    });
    return rules;
  };
  var PluralResolver = class {
    constructor(languageUtils) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      this.languageUtils = languageUtils;
      this.options = options;
      this.logger = baseLogger.create("pluralResolver");
      if ((!this.options.compatibilityJSON || intlVersions.includes(this.options.compatibilityJSON)) && (typeof Intl === "undefined" || !Intl.PluralRules)) {
        this.options.compatibilityJSON = "v3";
        this.logger.error("Your environment seems not to be Intl API compatible, use an Intl.PluralRules polyfill. Will fallback to the compatibilityJSON v3 format handling.");
      }
      this.rules = createRules();
      this.pluralRulesCache = {};
    }
    addRule(lng, obj) {
      this.rules[lng] = obj;
    }
    clearCache() {
      this.pluralRulesCache = {};
    }
    getRule(code) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      if (this.shouldUseIntlApi()) {
        const cleanedCode = getCleanedCode(code === "dev" ? "en" : code);
        const type = options.ordinal ? "ordinal" : "cardinal";
        const cacheKey = JSON.stringify({
          cleanedCode,
          type
        });
        if (cacheKey in this.pluralRulesCache) {
          return this.pluralRulesCache[cacheKey];
        }
        let rule;
        try {
          rule = new Intl.PluralRules(cleanedCode, {
            type
          });
        } catch (err) {
          if (!code.match(/-|_/)) return;
          const lngPart = this.languageUtils.getLanguagePartFromCode(code);
          rule = this.getRule(lngPart, options);
        }
        this.pluralRulesCache[cacheKey] = rule;
        return rule;
      }
      return this.rules[code] || this.rules[this.languageUtils.getLanguagePartFromCode(code)];
    }
    needsPlural(code) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      const rule = this.getRule(code, options);
      if (this.shouldUseIntlApi()) {
        return rule && rule.resolvedOptions().pluralCategories.length > 1;
      }
      return rule && rule.numbers.length > 1;
    }
    getPluralFormsOfKey(code, key) {
      let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      return this.getSuffixes(code, options).map((suffix) => `${key}${suffix}`);
    }
    getSuffixes(code) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      const rule = this.getRule(code, options);
      if (!rule) {
        return [];
      }
      if (this.shouldUseIntlApi()) {
        return rule.resolvedOptions().pluralCategories.sort((pluralCategory1, pluralCategory2) => suffixesOrder[pluralCategory1] - suffixesOrder[pluralCategory2]).map((pluralCategory) => `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ""}${pluralCategory}`);
      }
      return rule.numbers.map((number) => this.getSuffix(code, number, options));
    }
    getSuffix(code, count3) {
      let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      const rule = this.getRule(code, options);
      if (rule) {
        if (this.shouldUseIntlApi()) {
          return `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ""}${rule.select(count3)}`;
        }
        return this.getSuffixRetroCompatible(rule, count3);
      }
      this.logger.warn(`no plural rule found for: ${code}`);
      return "";
    }
    getSuffixRetroCompatible(rule, count3) {
      const idx = rule.noAbs ? rule.plurals(count3) : rule.plurals(Math.abs(count3));
      let suffix = rule.numbers[idx];
      if (this.options.simplifyPluralSuffix && rule.numbers.length === 2 && rule.numbers[0] === 1) {
        if (suffix === 2) {
          suffix = "plural";
        } else if (suffix === 1) {
          suffix = "";
        }
      }
      const returnSuffix = () => this.options.prepend && suffix.toString() ? this.options.prepend + suffix.toString() : suffix.toString();
      if (this.options.compatibilityJSON === "v1") {
        if (suffix === 1) return "";
        if (typeof suffix === "number") return `_plural_${suffix.toString()}`;
        return returnSuffix();
      } else if (this.options.compatibilityJSON === "v2") {
        return returnSuffix();
      } else if (this.options.simplifyPluralSuffix && rule.numbers.length === 2 && rule.numbers[0] === 1) {
        return returnSuffix();
      }
      return this.options.prepend && idx.toString() ? this.options.prepend + idx.toString() : idx.toString();
    }
    shouldUseIntlApi() {
      return !nonIntlVersions.includes(this.options.compatibilityJSON);
    }
  };
  var deepFindWithDefaults = function(data, defaultData, key) {
    let keySeparator = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : ".";
    let ignoreJSONStructure = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : true;
    let path = getPathWithDefaults(data, defaultData, key);
    if (!path && ignoreJSONStructure && isString(key)) {
      path = deepFind(data, key, keySeparator);
      if (path === void 0) path = deepFind(defaultData, key, keySeparator);
    }
    return path;
  };
  var regexSafe = (val) => val.replace(/\$/g, "$$$$");
  var Interpolator = class {
    constructor() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      this.logger = baseLogger.create("interpolator");
      this.options = options;
      this.format = options.interpolation && options.interpolation.format || ((value) => value);
      this.init(options);
    }
    init() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      if (!options.interpolation) options.interpolation = {
        escapeValue: true
      };
      const {
        escape: escape$1,
        escapeValue,
        useRawValueToEscape,
        prefix,
        prefixEscaped,
        suffix,
        suffixEscaped,
        formatSeparator,
        unescapeSuffix,
        unescapePrefix,
        nestingPrefix,
        nestingPrefixEscaped,
        nestingSuffix,
        nestingSuffixEscaped,
        nestingOptionsSeparator,
        maxReplaces,
        alwaysFormat
      } = options.interpolation;
      this.escape = escape$1 !== void 0 ? escape$1 : escape;
      this.escapeValue = escapeValue !== void 0 ? escapeValue : true;
      this.useRawValueToEscape = useRawValueToEscape !== void 0 ? useRawValueToEscape : false;
      this.prefix = prefix ? regexEscape(prefix) : prefixEscaped || "{{";
      this.suffix = suffix ? regexEscape(suffix) : suffixEscaped || "}}";
      this.formatSeparator = formatSeparator || ",";
      this.unescapePrefix = unescapeSuffix ? "" : unescapePrefix || "-";
      this.unescapeSuffix = this.unescapePrefix ? "" : unescapeSuffix || "";
      this.nestingPrefix = nestingPrefix ? regexEscape(nestingPrefix) : nestingPrefixEscaped || regexEscape("$t(");
      this.nestingSuffix = nestingSuffix ? regexEscape(nestingSuffix) : nestingSuffixEscaped || regexEscape(")");
      this.nestingOptionsSeparator = nestingOptionsSeparator || ",";
      this.maxReplaces = maxReplaces || 1e3;
      this.alwaysFormat = alwaysFormat !== void 0 ? alwaysFormat : false;
      this.resetRegExp();
    }
    reset() {
      if (this.options) this.init(this.options);
    }
    resetRegExp() {
      const getOrResetRegExp = (existingRegExp, pattern) => {
        if (existingRegExp && existingRegExp.source === pattern) {
          existingRegExp.lastIndex = 0;
          return existingRegExp;
        }
        return new RegExp(pattern, "g");
      };
      this.regexp = getOrResetRegExp(this.regexp, `${this.prefix}(.+?)${this.suffix}`);
      this.regexpUnescape = getOrResetRegExp(this.regexpUnescape, `${this.prefix}${this.unescapePrefix}(.+?)${this.unescapeSuffix}${this.suffix}`);
      this.nestingRegexp = getOrResetRegExp(this.nestingRegexp, `${this.nestingPrefix}(.+?)${this.nestingSuffix}`);
    }
    interpolate(str, data, lng, options) {
      let match;
      let value;
      let replaces;
      const defaultData = this.options && this.options.interpolation && this.options.interpolation.defaultVariables || {};
      const handleFormat = (key) => {
        if (key.indexOf(this.formatSeparator) < 0) {
          const path = deepFindWithDefaults(data, defaultData, key, this.options.keySeparator, this.options.ignoreJSONStructure);
          return this.alwaysFormat ? this.format(path, void 0, lng, {
            ...options,
            ...data,
            interpolationkey: key
          }) : path;
        }
        const p = key.split(this.formatSeparator);
        const k = p.shift().trim();
        const f = p.join(this.formatSeparator).trim();
        return this.format(deepFindWithDefaults(data, defaultData, k, this.options.keySeparator, this.options.ignoreJSONStructure), f, lng, {
          ...options,
          ...data,
          interpolationkey: k
        });
      };
      this.resetRegExp();
      const missingInterpolationHandler = options && options.missingInterpolationHandler || this.options.missingInterpolationHandler;
      const skipOnVariables = options && options.interpolation && options.interpolation.skipOnVariables !== void 0 ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables;
      const todos = [{
        regex: this.regexpUnescape,
        safeValue: (val) => regexSafe(val)
      }, {
        regex: this.regexp,
        safeValue: (val) => this.escapeValue ? regexSafe(this.escape(val)) : regexSafe(val)
      }];
      todos.forEach((todo) => {
        replaces = 0;
        while (match = todo.regex.exec(str)) {
          const matchedVar = match[1].trim();
          value = handleFormat(matchedVar);
          if (value === void 0) {
            if (typeof missingInterpolationHandler === "function") {
              const temp = missingInterpolationHandler(str, match, options);
              value = isString(temp) ? temp : "";
            } else if (options && Object.prototype.hasOwnProperty.call(options, matchedVar)) {
              value = "";
            } else if (skipOnVariables) {
              value = match[0];
              continue;
            } else {
              this.logger.warn(`missed to pass in variable ${matchedVar} for interpolating ${str}`);
              value = "";
            }
          } else if (!isString(value) && !this.useRawValueToEscape) {
            value = makeString(value);
          }
          const safeValue = todo.safeValue(value);
          str = str.replace(match[0], safeValue);
          if (skipOnVariables) {
            todo.regex.lastIndex += value.length;
            todo.regex.lastIndex -= match[0].length;
          } else {
            todo.regex.lastIndex = 0;
          }
          replaces++;
          if (replaces >= this.maxReplaces) {
            break;
          }
        }
      });
      return str;
    }
    nest(str, fc) {
      let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      let match;
      let value;
      let clonedOptions;
      const handleHasOptions = (key, inheritedOptions) => {
        const sep = this.nestingOptionsSeparator;
        if (key.indexOf(sep) < 0) return key;
        const c = key.split(new RegExp(`${sep}[ ]*{`));
        let optionsString = `{${c[1]}`;
        key = c[0];
        optionsString = this.interpolate(optionsString, clonedOptions);
        const matchedSingleQuotes = optionsString.match(/'/g);
        const matchedDoubleQuotes = optionsString.match(/"/g);
        if (matchedSingleQuotes && matchedSingleQuotes.length % 2 === 0 && !matchedDoubleQuotes || matchedDoubleQuotes.length % 2 !== 0) {
          optionsString = optionsString.replace(/'/g, '"');
        }
        try {
          clonedOptions = JSON.parse(optionsString);
          if (inheritedOptions) clonedOptions = {
            ...inheritedOptions,
            ...clonedOptions
          };
        } catch (e) {
          this.logger.warn(`failed parsing options string in nesting for key ${key}`, e);
          return `${key}${sep}${optionsString}`;
        }
        if (clonedOptions.defaultValue && clonedOptions.defaultValue.indexOf(this.prefix) > -1) delete clonedOptions.defaultValue;
        return key;
      };
      while (match = this.nestingRegexp.exec(str)) {
        let formatters = [];
        clonedOptions = {
          ...options
        };
        clonedOptions = clonedOptions.replace && !isString(clonedOptions.replace) ? clonedOptions.replace : clonedOptions;
        clonedOptions.applyPostProcessor = false;
        delete clonedOptions.defaultValue;
        let doReduce = false;
        if (match[0].indexOf(this.formatSeparator) !== -1 && !/{.*}/.test(match[1])) {
          const r = match[1].split(this.formatSeparator).map((elem) => elem.trim());
          match[1] = r.shift();
          formatters = r;
          doReduce = true;
        }
        value = fc(handleHasOptions.call(this, match[1].trim(), clonedOptions), clonedOptions);
        if (value && match[0] === str && !isString(value)) return value;
        if (!isString(value)) value = makeString(value);
        if (!value) {
          this.logger.warn(`missed to resolve ${match[1]} for nesting ${str}`);
          value = "";
        }
        if (doReduce) {
          value = formatters.reduce((v, f) => this.format(v, f, options.lng, {
            ...options,
            interpolationkey: match[1].trim()
          }), value.trim());
        }
        str = str.replace(match[0], value);
        this.regexp.lastIndex = 0;
      }
      return str;
    }
  };
  var parseFormatStr = (formatStr) => {
    let formatName = formatStr.toLowerCase().trim();
    const formatOptions = {};
    if (formatStr.indexOf("(") > -1) {
      const p = formatStr.split("(");
      formatName = p[0].toLowerCase().trim();
      const optStr = p[1].substring(0, p[1].length - 1);
      if (formatName === "currency" && optStr.indexOf(":") < 0) {
        if (!formatOptions.currency) formatOptions.currency = optStr.trim();
      } else if (formatName === "relativetime" && optStr.indexOf(":") < 0) {
        if (!formatOptions.range) formatOptions.range = optStr.trim();
      } else {
        const opts = optStr.split(";");
        opts.forEach((opt) => {
          if (opt) {
            const [key, ...rest] = opt.split(":");
            const val = rest.join(":").trim().replace(/^'+|'+$/g, "");
            const trimmedKey = key.trim();
            if (!formatOptions[trimmedKey]) formatOptions[trimmedKey] = val;
            if (val === "false") formatOptions[trimmedKey] = false;
            if (val === "true") formatOptions[trimmedKey] = true;
            if (!isNaN(val)) formatOptions[trimmedKey] = parseInt(val, 10);
          }
        });
      }
    }
    return {
      formatName,
      formatOptions
    };
  };
  var createCachedFormatter = (fn) => {
    const cache = {};
    return (val, lng, options) => {
      let optForCache = options;
      if (options && options.interpolationkey && options.formatParams && options.formatParams[options.interpolationkey] && options[options.interpolationkey]) {
        optForCache = {
          ...optForCache,
          [options.interpolationkey]: void 0
        };
      }
      const key = lng + JSON.stringify(optForCache);
      let formatter = cache[key];
      if (!formatter) {
        formatter = fn(getCleanedCode(lng), options);
        cache[key] = formatter;
      }
      return formatter(val);
    };
  };
  var Formatter = class {
    constructor() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      this.logger = baseLogger.create("formatter");
      this.options = options;
      this.formats = {
        number: createCachedFormatter((lng, opt) => {
          const formatter = new Intl.NumberFormat(lng, {
            ...opt
          });
          return (val) => formatter.format(val);
        }),
        currency: createCachedFormatter((lng, opt) => {
          const formatter = new Intl.NumberFormat(lng, {
            ...opt,
            style: "currency"
          });
          return (val) => formatter.format(val);
        }),
        datetime: createCachedFormatter((lng, opt) => {
          const formatter = new Intl.DateTimeFormat(lng, {
            ...opt
          });
          return (val) => formatter.format(val);
        }),
        relativetime: createCachedFormatter((lng, opt) => {
          const formatter = new Intl.RelativeTimeFormat(lng, {
            ...opt
          });
          return (val) => formatter.format(val, opt.range || "day");
        }),
        list: createCachedFormatter((lng, opt) => {
          const formatter = new Intl.ListFormat(lng, {
            ...opt
          });
          return (val) => formatter.format(val);
        })
      };
      this.init(options);
    }
    init(services) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
        interpolation: {}
      };
      this.formatSeparator = options.interpolation.formatSeparator || ",";
    }
    add(name, fc) {
      this.formats[name.toLowerCase().trim()] = fc;
    }
    addCached(name, fc) {
      this.formats[name.toLowerCase().trim()] = createCachedFormatter(fc);
    }
    format(value, format, lng) {
      let options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
      const formats = format.split(this.formatSeparator);
      if (formats.length > 1 && formats[0].indexOf("(") > 1 && formats[0].indexOf(")") < 0 && formats.find((f) => f.indexOf(")") > -1)) {
        const lastIndex = formats.findIndex((f) => f.indexOf(")") > -1);
        formats[0] = [formats[0], ...formats.splice(1, lastIndex)].join(this.formatSeparator);
      }
      const result = formats.reduce((mem, f) => {
        const {
          formatName,
          formatOptions
        } = parseFormatStr(f);
        if (this.formats[formatName]) {
          let formatted = mem;
          try {
            const valOptions = options && options.formatParams && options.formatParams[options.interpolationkey] || {};
            const l = valOptions.locale || valOptions.lng || options.locale || options.lng || lng;
            formatted = this.formats[formatName](mem, l, {
              ...formatOptions,
              ...options,
              ...valOptions
            });
          } catch (error) {
            this.logger.warn(error);
          }
          return formatted;
        } else {
          this.logger.warn(`there was no format function for ${formatName}`);
        }
        return mem;
      }, value);
      return result;
    }
  };
  var removePending = (q, name) => {
    if (q.pending[name] !== void 0) {
      delete q.pending[name];
      q.pendingCount--;
    }
  };
  var Connector = class extends EventEmitter {
    constructor(backend, store, services) {
      let options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
      super();
      this.backend = backend;
      this.store = store;
      this.services = services;
      this.languageUtils = services.languageUtils;
      this.options = options;
      this.logger = baseLogger.create("backendConnector");
      this.waitingReads = [];
      this.maxParallelReads = options.maxParallelReads || 10;
      this.readingCalls = 0;
      this.maxRetries = options.maxRetries >= 0 ? options.maxRetries : 5;
      this.retryTimeout = options.retryTimeout >= 1 ? options.retryTimeout : 350;
      this.state = {};
      this.queue = [];
      if (this.backend && this.backend.init) {
        this.backend.init(services, options.backend, options);
      }
    }
    queueLoad(languages, namespaces, options, callback) {
      const toLoad = {};
      const pending = {};
      const toLoadLanguages = {};
      const toLoadNamespaces = {};
      languages.forEach((lng) => {
        let hasAllNamespaces = true;
        namespaces.forEach((ns) => {
          const name = `${lng}|${ns}`;
          if (!options.reload && this.store.hasResourceBundle(lng, ns)) {
            this.state[name] = 2;
          } else if (this.state[name] < 0) ;
          else if (this.state[name] === 1) {
            if (pending[name] === void 0) pending[name] = true;
          } else {
            this.state[name] = 1;
            hasAllNamespaces = false;
            if (pending[name] === void 0) pending[name] = true;
            if (toLoad[name] === void 0) toLoad[name] = true;
            if (toLoadNamespaces[ns] === void 0) toLoadNamespaces[ns] = true;
          }
        });
        if (!hasAllNamespaces) toLoadLanguages[lng] = true;
      });
      if (Object.keys(toLoad).length || Object.keys(pending).length) {
        this.queue.push({
          pending,
          pendingCount: Object.keys(pending).length,
          loaded: {},
          errors: [],
          callback
        });
      }
      return {
        toLoad: Object.keys(toLoad),
        pending: Object.keys(pending),
        toLoadLanguages: Object.keys(toLoadLanguages),
        toLoadNamespaces: Object.keys(toLoadNamespaces)
      };
    }
    loaded(name, err, data) {
      const s = name.split("|");
      const lng = s[0];
      const ns = s[1];
      if (err) this.emit("failedLoading", lng, ns, err);
      if (!err && data) {
        this.store.addResourceBundle(lng, ns, data, void 0, void 0, {
          skipCopy: true
        });
      }
      this.state[name] = err ? -1 : 2;
      if (err && data) this.state[name] = 0;
      const loaded = {};
      this.queue.forEach((q) => {
        pushPath(q.loaded, [lng], ns);
        removePending(q, name);
        if (err) q.errors.push(err);
        if (q.pendingCount === 0 && !q.done) {
          Object.keys(q.loaded).forEach((l) => {
            if (!loaded[l]) loaded[l] = {};
            const loadedKeys = q.loaded[l];
            if (loadedKeys.length) {
              loadedKeys.forEach((n) => {
                if (loaded[l][n] === void 0) loaded[l][n] = true;
              });
            }
          });
          q.done = true;
          if (q.errors.length) {
            q.callback(q.errors);
          } else {
            q.callback();
          }
        }
      });
      this.emit("loaded", loaded);
      this.queue = this.queue.filter((q) => !q.done);
    }
    read(lng, ns, fcName) {
      let tried = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0;
      let wait = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : this.retryTimeout;
      let callback = arguments.length > 5 ? arguments[5] : void 0;
      if (!lng.length) return callback(null, {});
      if (this.readingCalls >= this.maxParallelReads) {
        this.waitingReads.push({
          lng,
          ns,
          fcName,
          tried,
          wait,
          callback
        });
        return;
      }
      this.readingCalls++;
      const resolver = (err, data) => {
        this.readingCalls--;
        if (this.waitingReads.length > 0) {
          const next = this.waitingReads.shift();
          this.read(next.lng, next.ns, next.fcName, next.tried, next.wait, next.callback);
        }
        if (err && data && tried < this.maxRetries) {
          setTimeout(() => {
            this.read.call(this, lng, ns, fcName, tried + 1, wait * 2, callback);
          }, wait);
          return;
        }
        callback(err, data);
      };
      const fc = this.backend[fcName].bind(this.backend);
      if (fc.length === 2) {
        try {
          const r = fc(lng, ns);
          if (r && typeof r.then === "function") {
            r.then((data) => resolver(null, data)).catch(resolver);
          } else {
            resolver(null, r);
          }
        } catch (err) {
          resolver(err);
        }
        return;
      }
      return fc(lng, ns, resolver);
    }
    prepareLoading(languages, namespaces) {
      let options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      let callback = arguments.length > 3 ? arguments[3] : void 0;
      if (!this.backend) {
        this.logger.warn("No backend was added via i18next.use. Will not load resources.");
        return callback && callback();
      }
      if (isString(languages)) languages = this.languageUtils.toResolveHierarchy(languages);
      if (isString(namespaces)) namespaces = [namespaces];
      const toLoad = this.queueLoad(languages, namespaces, options, callback);
      if (!toLoad.toLoad.length) {
        if (!toLoad.pending.length) callback();
        return null;
      }
      toLoad.toLoad.forEach((name) => {
        this.loadOne(name);
      });
    }
    load(languages, namespaces, callback) {
      this.prepareLoading(languages, namespaces, {}, callback);
    }
    reload(languages, namespaces, callback) {
      this.prepareLoading(languages, namespaces, {
        reload: true
      }, callback);
    }
    loadOne(name) {
      let prefix = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : "";
      const s = name.split("|");
      const lng = s[0];
      const ns = s[1];
      this.read(lng, ns, "read", void 0, void 0, (err, data) => {
        if (err) this.logger.warn(`${prefix}loading namespace ${ns} for language ${lng} failed`, err);
        if (!err && data) this.logger.log(`${prefix}loaded namespace ${ns} for language ${lng}`, data);
        this.loaded(name, err, data);
      });
    }
    saveMissing(languages, namespace, key, fallbackValue, isUpdate) {
      let options = arguments.length > 5 && arguments[5] !== void 0 ? arguments[5] : {};
      let clb = arguments.length > 6 && arguments[6] !== void 0 ? arguments[6] : () => {
      };
      if (this.services.utils && this.services.utils.hasLoadedNamespace && !this.services.utils.hasLoadedNamespace(namespace)) {
        this.logger.warn(`did not save key "${key}" as the namespace "${namespace}" was not yet loaded`, "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
        return;
      }
      if (key === void 0 || key === null || key === "") return;
      if (this.backend && this.backend.create) {
        const opts = {
          ...options,
          isUpdate
        };
        const fc = this.backend.create.bind(this.backend);
        if (fc.length < 6) {
          try {
            let r;
            if (fc.length === 5) {
              r = fc(languages, namespace, key, fallbackValue, opts);
            } else {
              r = fc(languages, namespace, key, fallbackValue);
            }
            if (r && typeof r.then === "function") {
              r.then((data) => clb(null, data)).catch(clb);
            } else {
              clb(null, r);
            }
          } catch (err) {
            clb(err);
          }
        } else {
          fc(languages, namespace, key, fallbackValue, clb, opts);
        }
      }
      if (!languages || !languages[0]) return;
      this.store.addResource(languages[0], namespace, key, fallbackValue);
    }
  };
  var get = () => ({
    debug: false,
    initImmediate: true,
    ns: ["translation"],
    defaultNS: ["translation"],
    fallbackLng: ["dev"],
    fallbackNS: false,
    supportedLngs: false,
    nonExplicitSupportedLngs: false,
    load: "all",
    preload: false,
    simplifyPluralSuffix: true,
    keySeparator: ".",
    nsSeparator: ":",
    pluralSeparator: "_",
    contextSeparator: "_",
    partialBundledLanguages: false,
    saveMissing: false,
    updateMissing: false,
    saveMissingTo: "fallback",
    saveMissingPlurals: true,
    missingKeyHandler: false,
    missingInterpolationHandler: false,
    postProcess: false,
    postProcessPassResolved: false,
    returnNull: false,
    returnEmptyString: true,
    returnObjects: false,
    joinArrays: false,
    returnedObjectHandler: false,
    parseMissingKeyHandler: false,
    appendNamespaceToMissingKey: false,
    appendNamespaceToCIMode: false,
    overloadTranslationOptionHandler: (args) => {
      let ret = {};
      if (typeof args[1] === "object") ret = args[1];
      if (isString(args[1])) ret.defaultValue = args[1];
      if (isString(args[2])) ret.tDescription = args[2];
      if (typeof args[2] === "object" || typeof args[3] === "object") {
        const options = args[3] || args[2];
        Object.keys(options).forEach((key) => {
          ret[key] = options[key];
        });
      }
      return ret;
    },
    interpolation: {
      escapeValue: true,
      format: (value) => value,
      prefix: "{{",
      suffix: "}}",
      formatSeparator: ",",
      unescapePrefix: "-",
      nestingPrefix: "$t(",
      nestingSuffix: ")",
      nestingOptionsSeparator: ",",
      maxReplaces: 1e3,
      skipOnVariables: true
    }
  });
  var transformOptions = (options) => {
    if (isString(options.ns)) options.ns = [options.ns];
    if (isString(options.fallbackLng)) options.fallbackLng = [options.fallbackLng];
    if (isString(options.fallbackNS)) options.fallbackNS = [options.fallbackNS];
    if (options.supportedLngs && options.supportedLngs.indexOf("cimode") < 0) {
      options.supportedLngs = options.supportedLngs.concat(["cimode"]);
    }
    return options;
  };
  var noop = () => {
  };
  var bindMemberFunctions = (inst) => {
    const mems = Object.getOwnPropertyNames(Object.getPrototypeOf(inst));
    mems.forEach((mem) => {
      if (typeof inst[mem] === "function") {
        inst[mem] = inst[mem].bind(inst);
      }
    });
  };
  var I18n = class _I18n extends EventEmitter {
    constructor() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      let callback = arguments.length > 1 ? arguments[1] : void 0;
      super();
      this.options = transformOptions(options);
      this.services = {};
      this.logger = baseLogger;
      this.modules = {
        external: []
      };
      bindMemberFunctions(this);
      if (callback && !this.isInitialized && !options.isClone) {
        if (!this.options.initImmediate) {
          this.init(options, callback);
          return this;
        }
        setTimeout(() => {
          this.init(options, callback);
        }, 0);
      }
    }
    init() {
      var _this = this;
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      let callback = arguments.length > 1 ? arguments[1] : void 0;
      this.isInitializing = true;
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      if (!options.defaultNS && options.defaultNS !== false && options.ns) {
        if (isString(options.ns)) {
          options.defaultNS = options.ns;
        } else if (options.ns.indexOf("translation") < 0) {
          options.defaultNS = options.ns[0];
        }
      }
      const defOpts = get();
      this.options = {
        ...defOpts,
        ...this.options,
        ...transformOptions(options)
      };
      if (this.options.compatibilityAPI !== "v1") {
        this.options.interpolation = {
          ...defOpts.interpolation,
          ...this.options.interpolation
        };
      }
      if (options.keySeparator !== void 0) {
        this.options.userDefinedKeySeparator = options.keySeparator;
      }
      if (options.nsSeparator !== void 0) {
        this.options.userDefinedNsSeparator = options.nsSeparator;
      }
      const createClassOnDemand = (ClassOrObject) => {
        if (!ClassOrObject) return null;
        if (typeof ClassOrObject === "function") return new ClassOrObject();
        return ClassOrObject;
      };
      if (!this.options.isClone) {
        if (this.modules.logger) {
          baseLogger.init(createClassOnDemand(this.modules.logger), this.options);
        } else {
          baseLogger.init(null, this.options);
        }
        let formatter;
        if (this.modules.formatter) {
          formatter = this.modules.formatter;
        } else if (typeof Intl !== "undefined") {
          formatter = Formatter;
        }
        const lu = new LanguageUtil(this.options);
        this.store = new ResourceStore(this.options.resources, this.options);
        const s = this.services;
        s.logger = baseLogger;
        s.resourceStore = this.store;
        s.languageUtils = lu;
        s.pluralResolver = new PluralResolver(lu, {
          prepend: this.options.pluralSeparator,
          compatibilityJSON: this.options.compatibilityJSON,
          simplifyPluralSuffix: this.options.simplifyPluralSuffix
        });
        if (formatter && (!this.options.interpolation.format || this.options.interpolation.format === defOpts.interpolation.format)) {
          s.formatter = createClassOnDemand(formatter);
          s.formatter.init(s, this.options);
          this.options.interpolation.format = s.formatter.format.bind(s.formatter);
        }
        s.interpolator = new Interpolator(this.options);
        s.utils = {
          hasLoadedNamespace: this.hasLoadedNamespace.bind(this)
        };
        s.backendConnector = new Connector(createClassOnDemand(this.modules.backend), s.resourceStore, s, this.options);
        s.backendConnector.on("*", function(event) {
          for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            args[_key - 1] = arguments[_key];
          }
          _this.emit(event, ...args);
        });
        if (this.modules.languageDetector) {
          s.languageDetector = createClassOnDemand(this.modules.languageDetector);
          if (s.languageDetector.init) s.languageDetector.init(s, this.options.detection, this.options);
        }
        if (this.modules.i18nFormat) {
          s.i18nFormat = createClassOnDemand(this.modules.i18nFormat);
          if (s.i18nFormat.init) s.i18nFormat.init(this);
        }
        this.translator = new Translator(this.services, this.options);
        this.translator.on("*", function(event) {
          for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
            args[_key2 - 1] = arguments[_key2];
          }
          _this.emit(event, ...args);
        });
        this.modules.external.forEach((m) => {
          if (m.init) m.init(this);
        });
      }
      this.format = this.options.interpolation.format;
      if (!callback) callback = noop;
      if (this.options.fallbackLng && !this.services.languageDetector && !this.options.lng) {
        const codes = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
        if (codes.length > 0 && codes[0] !== "dev") this.options.lng = codes[0];
      }
      if (!this.services.languageDetector && !this.options.lng) {
        this.logger.warn("init: no languageDetector is used and no lng is defined");
      }
      const storeApi = ["getResource", "hasResourceBundle", "getResourceBundle", "getDataByLanguage"];
      storeApi.forEach((fcName) => {
        this[fcName] = function() {
          return _this.store[fcName](...arguments);
        };
      });
      const storeApiChained = ["addResource", "addResources", "addResourceBundle", "removeResourceBundle"];
      storeApiChained.forEach((fcName) => {
        this[fcName] = function() {
          _this.store[fcName](...arguments);
          return _this;
        };
      });
      const deferred = defer();
      const load = () => {
        const finish = (err, t3) => {
          this.isInitializing = false;
          if (this.isInitialized && !this.initializedStoreOnce) this.logger.warn("init: i18next is already initialized. You should call init just once!");
          this.isInitialized = true;
          if (!this.options.isClone) this.logger.log("initialized", this.options);
          this.emit("initialized", this.options);
          deferred.resolve(t3);
          callback(err, t3);
        };
        if (this.languages && this.options.compatibilityAPI !== "v1" && !this.isInitialized) return finish(null, this.t.bind(this));
        this.changeLanguage(this.options.lng, finish);
      };
      if (this.options.resources || !this.options.initImmediate) {
        load();
      } else {
        setTimeout(load, 0);
      }
      return deferred;
    }
    loadResources(language) {
      let callback = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : noop;
      let usedCallback = callback;
      const usedLng = isString(language) ? language : this.language;
      if (typeof language === "function") usedCallback = language;
      if (!this.options.resources || this.options.partialBundledLanguages) {
        if (usedLng && usedLng.toLowerCase() === "cimode" && (!this.options.preload || this.options.preload.length === 0)) return usedCallback();
        const toLoad = [];
        const append = (lng) => {
          if (!lng) return;
          if (lng === "cimode") return;
          const lngs = this.services.languageUtils.toResolveHierarchy(lng);
          lngs.forEach((l) => {
            if (l === "cimode") return;
            if (toLoad.indexOf(l) < 0) toLoad.push(l);
          });
        };
        if (!usedLng) {
          const fallbacks = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
          fallbacks.forEach((l) => append(l));
        } else {
          append(usedLng);
        }
        if (this.options.preload) {
          this.options.preload.forEach((l) => append(l));
        }
        this.services.backendConnector.load(toLoad, this.options.ns, (e) => {
          if (!e && !this.resolvedLanguage && this.language) this.setResolvedLanguage(this.language);
          usedCallback(e);
        });
      } else {
        usedCallback(null);
      }
    }
    reloadResources(lngs, ns, callback) {
      const deferred = defer();
      if (typeof lngs === "function") {
        callback = lngs;
        lngs = void 0;
      }
      if (typeof ns === "function") {
        callback = ns;
        ns = void 0;
      }
      if (!lngs) lngs = this.languages;
      if (!ns) ns = this.options.ns;
      if (!callback) callback = noop;
      this.services.backendConnector.reload(lngs, ns, (err) => {
        deferred.resolve();
        callback(err);
      });
      return deferred;
    }
    use(module) {
      if (!module) throw new Error("You are passing an undefined module! Please check the object you are passing to i18next.use()");
      if (!module.type) throw new Error("You are passing a wrong module! Please check the object you are passing to i18next.use()");
      if (module.type === "backend") {
        this.modules.backend = module;
      }
      if (module.type === "logger" || module.log && module.warn && module.error) {
        this.modules.logger = module;
      }
      if (module.type === "languageDetector") {
        this.modules.languageDetector = module;
      }
      if (module.type === "i18nFormat") {
        this.modules.i18nFormat = module;
      }
      if (module.type === "postProcessor") {
        postProcessor.addPostProcessor(module);
      }
      if (module.type === "formatter") {
        this.modules.formatter = module;
      }
      if (module.type === "3rdParty") {
        this.modules.external.push(module);
      }
      return this;
    }
    setResolvedLanguage(l) {
      if (!l || !this.languages) return;
      if (["cimode", "dev"].indexOf(l) > -1) return;
      for (let li = 0; li < this.languages.length; li++) {
        const lngInLngs = this.languages[li];
        if (["cimode", "dev"].indexOf(lngInLngs) > -1) continue;
        if (this.store.hasLanguageSomeTranslations(lngInLngs)) {
          this.resolvedLanguage = lngInLngs;
          break;
        }
      }
    }
    changeLanguage(lng, callback) {
      var _this2 = this;
      this.isLanguageChangingTo = lng;
      const deferred = defer();
      this.emit("languageChanging", lng);
      const setLngProps = (l) => {
        this.language = l;
        this.languages = this.services.languageUtils.toResolveHierarchy(l);
        this.resolvedLanguage = void 0;
        this.setResolvedLanguage(l);
      };
      const done = (err, l) => {
        if (l) {
          setLngProps(l);
          this.translator.changeLanguage(l);
          this.isLanguageChangingTo = void 0;
          this.emit("languageChanged", l);
          this.logger.log("languageChanged", l);
        } else {
          this.isLanguageChangingTo = void 0;
        }
        deferred.resolve(function() {
          return _this2.t(...arguments);
        });
        if (callback) callback(err, function() {
          return _this2.t(...arguments);
        });
      };
      const setLng = (lngs) => {
        if (!lng && !lngs && this.services.languageDetector) lngs = [];
        const l = isString(lngs) ? lngs : this.services.languageUtils.getBestMatchFromCodes(lngs);
        if (l) {
          if (!this.language) {
            setLngProps(l);
          }
          if (!this.translator.language) this.translator.changeLanguage(l);
          if (this.services.languageDetector && this.services.languageDetector.cacheUserLanguage) this.services.languageDetector.cacheUserLanguage(l);
        }
        this.loadResources(l, (err) => {
          done(err, l);
        });
      };
      if (!lng && this.services.languageDetector && !this.services.languageDetector.async) {
        setLng(this.services.languageDetector.detect());
      } else if (!lng && this.services.languageDetector && this.services.languageDetector.async) {
        if (this.services.languageDetector.detect.length === 0) {
          this.services.languageDetector.detect().then(setLng);
        } else {
          this.services.languageDetector.detect(setLng);
        }
      } else {
        setLng(lng);
      }
      return deferred;
    }
    getFixedT(lng, ns, keyPrefix) {
      var _this3 = this;
      const fixedT = function(key, opts) {
        let options;
        if (typeof opts !== "object") {
          for (var _len3 = arguments.length, rest = new Array(_len3 > 2 ? _len3 - 2 : 0), _key3 = 2; _key3 < _len3; _key3++) {
            rest[_key3 - 2] = arguments[_key3];
          }
          options = _this3.options.overloadTranslationOptionHandler([key, opts].concat(rest));
        } else {
          options = {
            ...opts
          };
        }
        options.lng = options.lng || fixedT.lng;
        options.lngs = options.lngs || fixedT.lngs;
        options.ns = options.ns || fixedT.ns;
        if (options.keyPrefix !== "") options.keyPrefix = options.keyPrefix || keyPrefix || fixedT.keyPrefix;
        const keySeparator = _this3.options.keySeparator || ".";
        let resultKey;
        if (options.keyPrefix && Array.isArray(key)) {
          resultKey = key.map((k) => `${options.keyPrefix}${keySeparator}${k}`);
        } else {
          resultKey = options.keyPrefix ? `${options.keyPrefix}${keySeparator}${key}` : key;
        }
        return _this3.t(resultKey, options);
      };
      if (isString(lng)) {
        fixedT.lng = lng;
      } else {
        fixedT.lngs = lng;
      }
      fixedT.ns = ns;
      fixedT.keyPrefix = keyPrefix;
      return fixedT;
    }
    t() {
      return this.translator && this.translator.translate(...arguments);
    }
    exists() {
      return this.translator && this.translator.exists(...arguments);
    }
    setDefaultNamespace(ns) {
      this.options.defaultNS = ns;
    }
    hasLoadedNamespace(ns) {
      let options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      if (!this.isInitialized) {
        this.logger.warn("hasLoadedNamespace: i18next was not initialized", this.languages);
        return false;
      }
      if (!this.languages || !this.languages.length) {
        this.logger.warn("hasLoadedNamespace: i18n.languages were undefined or empty", this.languages);
        return false;
      }
      const lng = options.lng || this.resolvedLanguage || this.languages[0];
      const fallbackLng = this.options ? this.options.fallbackLng : false;
      const lastLng = this.languages[this.languages.length - 1];
      if (lng.toLowerCase() === "cimode") return true;
      const loadNotPending = (l, n) => {
        const loadState = this.services.backendConnector.state[`${l}|${n}`];
        return loadState === -1 || loadState === 0 || loadState === 2;
      };
      if (options.precheck) {
        const preResult = options.precheck(this, loadNotPending);
        if (preResult !== void 0) return preResult;
      }
      if (this.hasResourceBundle(lng, ns)) return true;
      if (!this.services.backendConnector.backend || this.options.resources && !this.options.partialBundledLanguages) return true;
      if (loadNotPending(lng, ns) && (!fallbackLng || loadNotPending(lastLng, ns))) return true;
      return false;
    }
    loadNamespaces(ns, callback) {
      const deferred = defer();
      if (!this.options.ns) {
        if (callback) callback();
        return Promise.resolve();
      }
      if (isString(ns)) ns = [ns];
      ns.forEach((n) => {
        if (this.options.ns.indexOf(n) < 0) this.options.ns.push(n);
      });
      this.loadResources((err) => {
        deferred.resolve();
        if (callback) callback(err);
      });
      return deferred;
    }
    loadLanguages(lngs, callback) {
      const deferred = defer();
      if (isString(lngs)) lngs = [lngs];
      const preloaded = this.options.preload || [];
      const newLngs = lngs.filter((lng) => preloaded.indexOf(lng) < 0 && this.services.languageUtils.isSupportedCode(lng));
      if (!newLngs.length) {
        if (callback) callback();
        return Promise.resolve();
      }
      this.options.preload = preloaded.concat(newLngs);
      this.loadResources((err) => {
        deferred.resolve();
        if (callback) callback(err);
      });
      return deferred;
    }
    dir(lng) {
      if (!lng) lng = this.resolvedLanguage || (this.languages && this.languages.length > 0 ? this.languages[0] : this.language);
      if (!lng) return "rtl";
      const rtlLngs = ["ar", "shu", "sqr", "ssh", "xaa", "yhd", "yud", "aao", "abh", "abv", "acm", "acq", "acw", "acx", "acy", "adf", "ads", "aeb", "aec", "afb", "ajp", "apc", "apd", "arb", "arq", "ars", "ary", "arz", "auz", "avl", "ayh", "ayl", "ayn", "ayp", "bbz", "pga", "he", "iw", "ps", "pbt", "pbu", "pst", "prp", "prd", "ug", "ur", "ydd", "yds", "yih", "ji", "yi", "hbo", "men", "xmn", "fa", "jpr", "peo", "pes", "prs", "dv", "sam", "ckb"];
      const languageUtils = this.services && this.services.languageUtils || new LanguageUtil(get());
      return rtlLngs.indexOf(languageUtils.getLanguagePartFromCode(lng)) > -1 || lng.toLowerCase().indexOf("-arab") > 1 ? "rtl" : "ltr";
    }
    static createInstance() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      let callback = arguments.length > 1 ? arguments[1] : void 0;
      return new _I18n(options, callback);
    }
    cloneInstance() {
      let options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      let callback = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : noop;
      const forkResourceStore = options.forkResourceStore;
      if (forkResourceStore) delete options.forkResourceStore;
      const mergedOptions = {
        ...this.options,
        ...options,
        ...{
          isClone: true
        }
      };
      const clone = new _I18n(mergedOptions);
      if (options.debug !== void 0 || options.prefix !== void 0) {
        clone.logger = clone.logger.clone(options);
      }
      const membersToCopy = ["store", "services", "language"];
      membersToCopy.forEach((m) => {
        clone[m] = this[m];
      });
      clone.services = {
        ...this.services
      };
      clone.services.utils = {
        hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
      };
      if (forkResourceStore) {
        clone.store = new ResourceStore(this.store.data, mergedOptions);
        clone.services.resourceStore = clone.store;
      }
      clone.translator = new Translator(clone.services, mergedOptions);
      clone.translator.on("*", function(event) {
        for (var _len4 = arguments.length, args = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
          args[_key4 - 1] = arguments[_key4];
        }
        clone.emit(event, ...args);
      });
      clone.init(mergedOptions, callback);
      clone.translator.options = mergedOptions;
      clone.translator.backendConnector.services.utils = {
        hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
      };
      return clone;
    }
    toJSON() {
      return {
        options: this.options,
        store: this.store,
        language: this.language,
        languages: this.languages,
        resolvedLanguage: this.resolvedLanguage
      };
    }
  };
  var instance = I18n.createInstance();
  instance.createInstance = I18n.createInstance;
  var createInstance = instance.createInstance;
  var dir = instance.dir;
  var init = instance.init;
  var loadResources = instance.loadResources;
  var reloadResources = instance.reloadResources;
  var use = instance.use;
  var changeLanguage = instance.changeLanguage;
  var getFixedT = instance.getFixedT;
  var t = instance.t;
  var exists = instance.exists;
  var setDefaultNamespace = instance.setDefaultNamespace;
  var hasLoadedNamespace = instance.hasLoadedNamespace;
  var loadNamespaces = instance.loadNamespaces;
  var loadLanguages = instance.loadLanguages;

  // node_modules/react-i18next/dist/es/Trans.js
  var import_react3 = __toESM(require_react(), 1);

  // node_modules/react-i18next/dist/es/TransWithoutContext.js
  var import_react = __toESM(require_react(), 1);

  // node_modules/html-parse-stringify/dist/html-parse-stringify.module.js
  var import_void_elements = __toESM(require_void_elements());

  // node_modules/react-i18next/dist/es/utils.js
  var warn = (i18n, code, msg2, rest) => {
    const args = [msg2, {
      code,
      ...rest || {}
    }];
    if (i18n?.services?.logger?.forward) {
      return i18n.services.logger.forward(args, "warn", "react-i18next::", true);
    }
    if (isString2(args[0])) args[0] = `react-i18next:: ${args[0]}`;
    if (i18n?.services?.logger?.warn) {
      i18n.services.logger.warn(...args);
    } else if (console?.warn) {
      console.warn(...args);
    }
  };
  var alreadyWarned = {};
  var warnOnce = (i18n, code, msg2, rest) => {
    if (isString2(msg2) && alreadyWarned[msg2]) return;
    if (isString2(msg2)) alreadyWarned[msg2] = /* @__PURE__ */ new Date();
    warn(i18n, code, msg2, rest);
  };
  var loadedClb = (i18n, cb) => () => {
    if (i18n.isInitialized) {
      cb();
    } else {
      const initialized = () => {
        setTimeout(() => {
          i18n.off("initialized", initialized);
        }, 0);
        cb();
      };
      i18n.on("initialized", initialized);
    }
  };
  var loadNamespaces2 = (i18n, ns, cb) => {
    i18n.loadNamespaces(ns, loadedClb(i18n, cb));
  };
  var loadLanguages2 = (i18n, lng, ns, cb) => {
    if (isString2(ns)) ns = [ns];
    if (i18n.options.preload && i18n.options.preload.indexOf(lng) > -1) return loadNamespaces2(i18n, ns, cb);
    ns.forEach((n) => {
      if (i18n.options.ns.indexOf(n) < 0) i18n.options.ns.push(n);
    });
    i18n.loadLanguages(lng, loadedClb(i18n, cb));
  };
  var hasLoadedNamespace2 = (ns, i18n, options = {}) => {
    if (!i18n.languages || !i18n.languages.length) {
      warnOnce(i18n, "NO_LANGUAGES", "i18n.languages were undefined or empty", {
        languages: i18n.languages
      });
      return true;
    }
    return i18n.hasLoadedNamespace(ns, {
      lng: options.lng,
      precheck: (i18nInstance2, loadNotPending) => {
        if (options.bindI18n && options.bindI18n.indexOf("languageChanging") > -1 && i18nInstance2.services.backendConnector.backend && i18nInstance2.isLanguageChangingTo && !loadNotPending(i18nInstance2.isLanguageChangingTo, ns)) return false;
      }
    });
  };
  var isString2 = (obj) => typeof obj === "string";
  var isObject = (obj) => typeof obj === "object" && obj !== null;

  // node_modules/react-i18next/dist/es/unescape.js
  var matchHtmlEntity = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34|nbsp|#160|copy|#169|reg|#174|hellip|#8230|#x2F|#47);/g;
  var htmlEntities = {
    "&amp;": "&",
    "&#38;": "&",
    "&lt;": "<",
    "&#60;": "<",
    "&gt;": ">",
    "&#62;": ">",
    "&apos;": "'",
    "&#39;": "'",
    "&quot;": '"',
    "&#34;": '"',
    "&nbsp;": " ",
    "&#160;": " ",
    "&copy;": "\xA9",
    "&#169;": "\xA9",
    "&reg;": "\xAE",
    "&#174;": "\xAE",
    "&hellip;": "\u2026",
    "&#8230;": "\u2026",
    "&#x2F;": "/",
    "&#47;": "/"
  };
  var unescapeHtmlEntity = (m) => htmlEntities[m];
  var unescape = (text) => text.replace(matchHtmlEntity, unescapeHtmlEntity);

  // node_modules/react-i18next/dist/es/defaults.js
  var defaultOptions = {
    bindI18n: "languageChanged",
    bindI18nStore: "",
    transEmptyNodeValue: "",
    transSupportBasicHtmlNodes: true,
    transWrapTextNodes: "",
    transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p"],
    useSuspense: true,
    unescape
  };
  var setDefaults = (options = {}) => {
    defaultOptions = {
      ...defaultOptions,
      ...options
    };
  };
  var getDefaults = () => defaultOptions;

  // node_modules/react-i18next/dist/es/i18nInstance.js
  var i18nInstance;
  var setI18n = (instance2) => {
    i18nInstance = instance2;
  };
  var getI18n = () => i18nInstance;

  // node_modules/react-i18next/dist/es/context.js
  var import_react2 = __toESM(require_react(), 1);

  // node_modules/react-i18next/dist/es/initReactI18next.js
  var initReactI18next = {
    type: "3rdParty",
    init(instance2) {
      setDefaults(instance2.options.react);
      setI18n(instance2);
    }
  };

  // node_modules/react-i18next/dist/es/context.js
  var I18nContext = (0, import_react2.createContext)();
  var ReportNamespaces = class {
    constructor() {
      this.usedNamespaces = {};
    }
    addUsedNamespaces(namespaces) {
      namespaces.forEach((ns) => {
        if (!this.usedNamespaces[ns]) this.usedNamespaces[ns] = true;
      });
    }
    getUsedNamespaces() {
      return Object.keys(this.usedNamespaces);
    }
  };

  // node_modules/react-i18next/dist/es/useTranslation.js
  var import_react4 = __toESM(require_react(), 1);
  var usePrevious = (value, ignore) => {
    const ref = (0, import_react4.useRef)();
    (0, import_react4.useEffect)(() => {
      ref.current = ignore ? ref.current : value;
    }, [value, ignore]);
    return ref.current;
  };
  var alwaysNewT = (i18n, language, namespace, keyPrefix) => i18n.getFixedT(language, namespace, keyPrefix);
  var useMemoizedT = (i18n, language, namespace, keyPrefix) => (0, import_react4.useCallback)(alwaysNewT(i18n, language, namespace, keyPrefix), [i18n, language, namespace, keyPrefix]);
  var useTranslation = (ns, props = {}) => {
    const {
      i18n: i18nFromProps
    } = props;
    const {
      i18n: i18nFromContext,
      defaultNS: defaultNSFromContext
    } = (0, import_react4.useContext)(I18nContext) || {};
    const i18n = i18nFromProps || i18nFromContext || getI18n();
    if (i18n && !i18n.reportNamespaces) i18n.reportNamespaces = new ReportNamespaces();
    if (!i18n) {
      warnOnce(i18n, "NO_I18NEXT_INSTANCE", "useTranslation: You will need to pass in an i18next instance by using initReactI18next");
      const notReadyT = (k, optsOrDefaultValue) => {
        if (isString2(optsOrDefaultValue)) return optsOrDefaultValue;
        if (isObject(optsOrDefaultValue) && isString2(optsOrDefaultValue.defaultValue)) return optsOrDefaultValue.defaultValue;
        return Array.isArray(k) ? k[k.length - 1] : k;
      };
      const retNotReady = [notReadyT, {}, false];
      retNotReady.t = notReadyT;
      retNotReady.i18n = {};
      retNotReady.ready = false;
      return retNotReady;
    }
    if (i18n.options.react?.wait) warnOnce(i18n, "DEPRECATED_OPTION", "useTranslation: It seems you are still using the old wait option, you may migrate to the new useSuspense behaviour.");
    const i18nOptions = {
      ...getDefaults(),
      ...i18n.options.react,
      ...props
    };
    const {
      useSuspense,
      keyPrefix
    } = i18nOptions;
    let namespaces = ns || defaultNSFromContext || i18n.options?.defaultNS;
    namespaces = isString2(namespaces) ? [namespaces] : namespaces || ["translation"];
    i18n.reportNamespaces.addUsedNamespaces?.(namespaces);
    const ready = (i18n.isInitialized || i18n.initializedStoreOnce) && namespaces.every((n) => hasLoadedNamespace2(n, i18n, i18nOptions));
    const memoGetT = useMemoizedT(i18n, props.lng || null, i18nOptions.nsMode === "fallback" ? namespaces : namespaces[0], keyPrefix);
    const getT = () => memoGetT;
    const getNewT = () => alwaysNewT(i18n, props.lng || null, i18nOptions.nsMode === "fallback" ? namespaces : namespaces[0], keyPrefix);
    const [t3, setT] = (0, import_react4.useState)(getT);
    let joinedNS = namespaces.join();
    if (props.lng) joinedNS = `${props.lng}${joinedNS}`;
    const previousJoinedNS = usePrevious(joinedNS);
    const isMounted = (0, import_react4.useRef)(true);
    (0, import_react4.useEffect)(() => {
      const {
        bindI18n,
        bindI18nStore
      } = i18nOptions;
      isMounted.current = true;
      if (!ready && !useSuspense) {
        if (props.lng) {
          loadLanguages2(i18n, props.lng, namespaces, () => {
            if (isMounted.current) setT(getNewT);
          });
        } else {
          loadNamespaces2(i18n, namespaces, () => {
            if (isMounted.current) setT(getNewT);
          });
        }
      }
      if (ready && previousJoinedNS && previousJoinedNS !== joinedNS && isMounted.current) {
        setT(getNewT);
      }
      const boundReset = () => {
        if (isMounted.current) setT(getNewT);
      };
      if (bindI18n) i18n?.on(bindI18n, boundReset);
      if (bindI18nStore) i18n?.store.on(bindI18nStore, boundReset);
      return () => {
        isMounted.current = false;
        if (i18n && bindI18n) bindI18n?.split(" ").forEach((e) => i18n.off(e, boundReset));
        if (bindI18nStore && i18n) bindI18nStore.split(" ").forEach((e) => i18n.store.off(e, boundReset));
      };
    }, [i18n, joinedNS]);
    (0, import_react4.useEffect)(() => {
      if (isMounted.current && ready) {
        setT(getT);
      }
    }, [i18n, keyPrefix, ready]);
    const ret = [t3, i18n, ready];
    ret.t = t3;
    ret.i18n = i18n;
    ret.ready = ready;
    if (ready) return ret;
    if (!ready && !useSuspense) return ret;
    throw new Promise((resolve) => {
      if (props.lng) {
        loadLanguages2(i18n, props.lng, namespaces, () => resolve());
      } else {
        loadNamespaces2(i18n, namespaces, () => resolve());
      }
    });
  };

  // node_modules/react-i18next/dist/es/withTranslation.js
  var import_react5 = __toESM(require_react(), 1);

  // node_modules/react-i18next/dist/es/I18nextProvider.js
  var import_react6 = __toESM(require_react(), 1);

  // node_modules/react-i18next/dist/es/withSSR.js
  var import_react8 = __toESM(require_react(), 1);

  // node_modules/react-i18next/dist/es/useSSR.js
  var import_react7 = __toESM(require_react(), 1);

  // src/renderer/i18n/zh-CN.json
  var zh_CN_default = {
    common: {
      appName: "Atrium",
      searchPlaceholder: "\u641C\u7D22\u7D20\u6750\uFF08\u652F\u6301\u62FC\u97F3 / \u5047\u540D / \u7F57\u9A6C\u5B57\uFF09",
      cancel: "\u53D6\u6D88",
      confirm: "\u786E\u5B9A",
      apply: "\u5E94\u7528",
      reset: "\u6062\u590D\u9ED8\u8BA4",
      close: "\u5173\u95ED",
      save: "\u4FDD\u5B58",
      reload: "\u91CD\u65B0\u8F7D\u5165",
      add: "\u6DFB\u52A0",
      remove: "\u5220\u9664",
      choose: "\u9009\u62E9\u2026",
      loading: "\u8F7D\u5165\u4E2D\u2026",
      empty: "\u8FD9\u91CC\u8FD8\u4EC0\u4E48\u90FD\u6CA1\u6709",
      trayShow: "\u663E\u793A\u4E3B\u7A97\u53E3",
      trayDrop: "\u8FF7\u4F60\u6295\u653E\u7A97",
      trayQuit: "\u9000\u51FA Atrium",
      undo: "\u64A4\u9500",
      redo: "\u91CD\u505A",
      trash: "\u79FB\u5165\u56DE\u6536\u7AD9",
      notSet: "\u672A\u8BBE\u7F6E",
      selectAll: "\u5168\u9009",
      clear: "\u6E05\u7A7A",
      search: "\u641C\u7D22",
      saving: "\u4FDD\u5B58\u4E2D\u2026"
    },
    status: {
      archived: "\u5DF2\u5F52\u6863",
      classified: "\u5DF2\u5206\u7C7B",
      pending_confirm: "\u5F85\u786E\u8BA4",
      inbox: "\u6536\u4EF6\u7BB1"
    },
    nav: {
      inbox: "\u6536\u4EF6\u7BB1",
      pending: "\u5F85\u786E\u8BA4",
      recent: "\u6700\u8FD1\u6DFB\u52A0",
      favorites: "\u6536\u85CF",
      collections: "\u96C6\u5408",
      categories: "\u5206\u7C7B",
      project: "\u5F53\u524D\u5DE5\u7A0B",
      settings: "\u8BBE\u7F6E",
      newCollection: "\u65B0\u5EFA\u96C6\u5408",
      collectionName: "\u96C6\u5408\u540D\u79F0",
      allAssets: "\u5168\u90E8\u7D20\u6750",
      bundles: "\u5408\u96C6"
    },
    library: {
      grid: "\u7F51\u683C",
      list: "\u5217\u8868",
      grouped: "\u805A\u5408",
      flat: "\u5E73\u94FA",
      variants: "{{count}} \u53D8\u4F53",
      bundle: "\u5408\u96C6",
      selected: "\u5DF2\u9009 {{count}} \u9879",
      gestureHint: "\u53CC\u51FB\u5BFC\u5165 \xB7 \u957F\u6309 1 \u79D2\u6253\u5F00\u5408\u96C6",
      bundleGestureHint: "\u53CC\u51FB\u4E00\u884C\u5BFC\u5165 \xB7 Enter \u9009\u5305 \xB7 Esc \u8FD4\u56DE",
      batchGestureHint: "\u5DF2\u9009 {{count}} \u9879 \xB7 \u53CC\u51FB\u5176\u4E2D\u4E00\u5F20\u4E00\u8D77\u5BFC\u5165",
      dblclickImportHint: "\u53CC\u51FB\u5361\u7247\u5BFC\u5165\u5230 {{name}}",
      dblclickImportHintNoTarget: "\u53CC\u51FB\u5361\u7247\u5BFC\u5165\uFF08\u4F1A\u5148\u8BF7\u4F60\u9009\u62E9\u5DE5\u7A0B\uFF09",
      holdToOpen: "\u957F\u6309 1 \u79D2\u6253\u5F00\u5408\u96C6",
      bundleTitleHint: "\u957F\u6309 1 \u79D2\u6253\u5F00\u5408\u96C6\uFF1B\u53CC\u51FB\u5BFC\u5165",
      rename: "\u91CD\u547D\u540D",
      reveal: "\u6253\u5F00\u6240\u5728\u6587\u4EF6\u5939",
      editMeta: "\u7F16\u8F91",
      source: "\u6765\u6E90",
      author: "\u4F5C\u8005",
      version: "\u7248\u672C",
      locale: "\u8BED\u8A00",
      confidence: "\u7F6E\u4FE1\u5EA6",
      reason: "\u5206\u7C7B\u7406\u7531",
      installed: "\u5DF2\u5BFC\u5165",
      partial: "\u90E8\u5206\u5BFC\u5165 ({{hit}}/{{total}})",
      notInstalled: "\u672A\u5BFC\u5165",
      unknown: "\u672A\u68C0\u6D4B",
      depends: "\u4F9D\u8D56",
      lastImport: "\u4E0A\u6B21\u5BFC\u5165",
      never: "\u4ECE\u672A\u5BFC\u5165",
      emptyTitle: "\u628A\u7D20\u6750\u62D6\u5230\u7A97\u53E3\u4EFB\u610F\u4F4D\u7F6E",
      emptyHint: "\u677E\u624B\u5373\u8BFB\u5185\u5BB9\u5E76\u5206\u7C7B",
      dropHint: "\u677E\u624B\u5373\u81EA\u52A8\u5206\u7C7B",
      pathMissing: "\u78C1\u76D8\u4E0A\u627E\u4E0D\u5230\u8FD9\u4E2A\u7D20\u6750\u4E86",
      suspectedSource: "\u7591\u4F3C\u6765\u6E90",
      tags: "\u6807\u7B7E",
      category: "\u5206\u7C7B",
      fixCategory: "\u6539\u9519\u4E86\uFF1F\u5728\u8FD9\u91CC\u4FEE\u6B63",
      contentPkg: "\u5305\u5185\u6E05\u5355",
      none: "\u65E0",
      importing: "\u6B63\u5728\u5BFC\u5165 {{name}}",
      queuedTitle: "\u5DF2\u6392\u961F\uFF08{{reason}}\uFF09",
      queuedRetry: "\u7B2C {{n}} \u6B21\u91CD\u8BD5",
      queuedNext: "{{s}} \u79D2\u540E\u91CD\u8BD5",
      queuedHint: "Unity \u73B0\u5728\u4E0D\u80FD\u63A5\u547D\u4EE4\uFF0C\u4F60\u7684\u5BFC\u5165\u5DF2\u7ECF\u6392\u4E0A\u961F\uFF1B\u9000\u51FA Play \u6A21\u5F0F\u540E\u4F1A\u81EA\u52A8\u7EE7\u7EED\uFF0C\u4E0D\u9700\u8981\u518D\u70B9\u4E00\u6B21\u3002",
      importDone: "\u5DF2\u5BFC\u5165\u300C{{name}}\u300D\uFF08\u65B0\u5EFA {{count}} \u4E2A\u8D44\u6E90\uFF09",
      importFailed: "\u5BFC\u5165\u5931\u8D25",
      importCancelled: "\u5DF2\u53D6\u6D88\u5BFC\u5165\uFF0C\u5DE5\u7A0B\u91CC\u4EC0\u4E48\u90FD\u6CA1\u6539",
      importOk: "\u5DF2\u5BFC\u5165",
      importResult: "\u5BFC\u5165\u5230\u300C{{project}}\u300D\uFF1A\u65B0\u5EFA {{created}} \u4E2A\u8D44\u6E90\u3001\u8986\u76D6 {{overwritten}} \u4E2A",
      backedUp: "\u88AB\u8986\u76D6\u7684\u6587\u4EF6\u5DF2\u5907\u4EFD",
      rollbackImport: "\u64A4\u9500\u8FD9\u6B21\u5BFC\u5165",
      rollbackDone: "\u5DF2\u64A4\u9500\uFF1A\u5220\u6389 {{deleted}} \u4E2A\u65B0\u5EFA\u8D44\u6E90\u3001\u8FD8\u539F {{restored}} \u4E2A\u88AB\u8986\u76D6\u6587\u4EF6",
      rollbackPartial: "\u5DF2\u64A4\u9500\uFF1A\u5220\u6389 {{deleted}} \u4E2A\u3001\u8FD8\u539F {{restored}} \u4E2A\uFF1B\u53E6\u6709 {{lost}} \u4E2A\u88AB\u8986\u76D6\u7684\u6587\u4EF6\u5F53\u65F6\u6CA1\u5F00\u5907\u4EFD\uFF0C\u5185\u5BB9\u627E\u4E0D\u56DE\u6765\u4E86",
      rollbackFailed: "\u64A4\u9500\u5BFC\u5165\u5931\u8D25",
      noImportablePackage: "\u8FD9\u4E2A\u7D20\u6750\u91CC\u6CA1\u6709\u53EF\u76F4\u63A5\u5BFC\u5165\u7684 .unitypackage\uFF08\u5B83\u53EF\u80FD\u662F\u4E2A\u6587\u4EF6\u5939\u6216\u538B\u7F29\u5305\uFF09",
      conflictTitle: "\u8FD9\u4E2A\u5305\u4F1A\u8986\u76D6\u5DE5\u7A0B\u91CC {{count}} \u4E2A\u5DF2\u6709\u6587\u4EF6",
      conflictIntro: "\u5305\u5185\u5171 {{total}} \u9879\uFF0C\u5176\u4E2D {{fresh}} \u9879\u662F\u65B0\u5EFA\u7684\u3002\u8981\u8986\u76D6\u7684\u6587\u4EF6\u5982\u4E0B\uFF08\u5DE6\u8FB9\u662F\u5DE5\u7A0B\u91CC\u7684\u73B0\u6709\u6587\u4EF6\uFF0C\u53F3\u8FB9\u662F\u5305\u91CC\u8981\u76D6\u4E0A\u53BB\u7684\uFF09\uFF1A",
      conflictIncoming: "\u5305\u5185\uFF1A",
      conflictContinue: "\u7EE7\u7EED\uFF08\u4E0D\u5907\u4EFD\uFF09",
      conflictContinueBackup: "\u7EE7\u7EED\u5E76\u5907\u4EFD\u88AB\u8986\u76D6\u6587\u4EF6",
      conflictBackupOn: "\u8BBE\u7F6E\u91CC\u300C\u88AB\u8986\u76D6\u6587\u4EF6\u5907\u4EFD\u300D\u662F\u5F00\u7740\u7684\uFF1A\u9009\u300C\u7EE7\u7EED\u300D\u4E5F\u4F1A\u5148\u5907\u4EFD\uFF0C\u4E4B\u540E\u53EF\u4EE5\u8FD8\u539F\u3002",
      conflictBackupOff: "\u26A0 \u8BBE\u7F6E\u91CC\u300C\u88AB\u8986\u76D6\u6587\u4EF6\u5907\u4EFD\u300D\u662F\u5173\u7740\u7684\uFF1A\u9009\u300C\u7EE7\u7EED\u300D\u4F1A\u76F4\u63A5\u8986\u76D6\uFF0C\u88AB\u8986\u76D6\u7684\u5185\u5BB9\u65E0\u6CD5\u8FD8\u539F\u3002",
      openFolder: "\u6253\u5F00\u6240\u5728\u6587\u4EF6\u5939",
      size: "\u5927\u5C0F",
      storage: "\u5B58\u50A8\u65B9\u5F0F",
      kind: "\u7C7B\u578B",
      updated: "\u66F4\u65B0",
      importState: "\u5DE5\u7A0B\u5185\u72B6\u6001",
      acceptClassification: "\u63A5\u53D7\u8FD9\u4E2A\u5206\u7C7B",
      dependsCount: "\u5916\u90E8\u4F9D\u8D56 {{external}} \u4E2A\uFF0C\u5E93\u5185\u5DF2\u6709 {{resolved}} \u4E2A\uFF0C\u7F3A\u5931 {{missing}} \u4E2A",
      bundleCard: "\u5408\u96C6 \xB7 \u542B {{count}} \u9879",
      bundleItems: "\u5408\u96C6\u91CC\u7684 {{count}} \u9879",
      bundleVersions: "{{count}} \u4E2A\u7248\u672C",
      bundleOneVersion: "1 \u4E2A\u7248\u672C",
      bundleOpen: "\u6253\u5F00\u5408\u96C6",
      bundleBack: "\u8FD4\u56DE\u5168\u90E8",
      bundleDissolve: "\u89E3\u6563\u5408\u96C6",
      bundleExtract: "\u4ECE\u5408\u96C6\u4E2D\u62C6\u51FA",
      bundleSelected: "\u5DF2\u9009 {{count}} \u9879",
      bundleNoMove: "\u5408\u96C6\u91CC\u7684\u6587\u4EF6\u4E0D\u4F1A\u88AB\u62C6\u5F00\u79FB\u52A8\uFF1B\u8981\u6539\u4F4D\u7F6E\u8BF7\u7528\u300C\u4ECE\u5408\u96C6\u4E2D\u62C6\u51FA\u300D\u540E\u518D\u5F52\u6863",
      containerMerged: "{{count}} \u4E2A\u6A21\u578B\u53D8\u4F53",
      containerCollection: "\u5408\u96C6 \xB7 \u542B {{count}} \u9879",
      containerCrumbAll: "\u5168\u90E8\u7D20\u6750",
      containerFilterAll: "\u5168\u90E8 ({{count}})",
      containerFilterModel: "\u6309\u6A21\u578B",
      containerFilterVersion: "\u6309\u7248\u672C",
      containerSearchPh: "\u5728\u8FD9\u4E2A\u5BB9\u5668\u91CC\u641C\u7D22\u2026",
      containerKeys: "Esc \u8FD4\u56DE\u4E0A\u4E00\u7EA7 \xB7 Ctrl+A \u5168\u9009 \xB7 Enter \u5BFC\u5165\u9009\u4E2D\u9879",
      containerAttachments: "\u9644\u5C5E\u8D44\u6E90\uFF08\u4E0D\u8FDB\u5E93\u5217\u8868\uFF0C\u5BFC\u5165\u65F6\u9ED8\u8BA4\u4E0D\u52FE\uFF09",
      attImage: "\u56FE\u5E93",
      attVideo: "\u5A92\u4F53",
      attDoc: "\u8BF4\u660E",
      attLink: "\u94FE\u63A5",
      attSource: "\u6E90\u6587\u4EF6",
      attAudio: "\u97F3\u9891",
      mergeSuggest: "\u300C{{name}}\u300D\u6709 {{count}} \u4E2A\u540C\u7CFB\u5217\u7D20\u6750\uFF0C\u8981\u5408\u5E76\u6210\u4E00\u5F20\u5361\u5417\uFF1F",
      mergeDo: "\u5408\u5E76\u5E76\u8FDB\u5165",
      mergeView: "\u67E5\u770B\u8FD9 {{count}} \u4E2A",
      mergeNever: "\u4E0D\u518D\u63D0\u793A",
      mergeDone: "\u5DF2\u5408\u5E76 {{count}} \u4E2A\u7D20\u6750\u6210\u4E00\u5F20\u5BB9\u5668\u5361",
      containerModelBadge: "\u6A21\u578B",
      batchResult: "\u8FD9\u6279\uFF1A\u6210\u529F {{ok}} \u4E2A\u3001\u5931\u8D25 {{failed}} \u4E2A\u3001\u6CA1\u6267\u884C {{notRun}} \u4E2A\u3001\u8DF3\u8FC7 {{blocked}} \u4E2A",
      batchDone: "\u5DF2\u5BFC\u5165 {{ok}} \u4E2A\u5305",
      memberAllHint: "\u8FD9\u91CC\u6CA1\u52FE\u5B50\u9879\u4E5F\u6CA1\u5173\u7CFB\uFF1A\u9762\u677F\u91CC\u52FE\u7684\u662F\u5BB9\u5668\u91CC\u7684\u5305",
      memberTitle: "\u9009\u8981\u5BFC\u5165\u7684\u5305",
      memberLoading: "\u6B63\u5728\u5217\u8FD9\u4E2A\u5BB9\u5668\u91CC\u7684\u5305\u2026",
      memberFound: "\u627E\u5230 {{count}} \u4E2A .unitypackage",
      memberOpenHint: "\u8FD9\u5F20\u5361\u91CC\u6709 {{count}} \u4E2A\u5305 \u2014\u2014 \u54EA\u4E2A\u90FD\u4E0D\u66FF\u4F60\u9009\uFF0C\u5728\u9762\u677F\u91CC\u52FE",
      memberTooBroad: "\u300C{{matched}}\u300D\u547D\u4E2D\u4E86 {{hits}}/{{total}} \u4E2A\uFF0C\u8FD9\u4E0D\u7B97\u533A\u5206\u5EA6\uFF0C\u5B83\u4E0D\u66FF\u4F60\u9009 \u2014\u2014 \u8BF7\u81EA\u5DF1\u52FE",
      memberNoPreselect: "\u6CA1\u627E\u5230\u80FD\u5F53\u4F9D\u636E\u7684\u540D\u5B57\uFF0C\u6240\u4EE5\u8C01\u90FD\u6CA1\u52FE \u2014\u2014 \u8BF7\u52FE",
      memberStart: "\u62BD\u53D6\u5E76\u68C0\u67E5\u8FD9 {{count}} \u4E2A",
      memberPickAll: "\u5168\u9009",
      memberClear: "\u6E05\u7A7A",
      memberUnder: "\u53EA\u52FE < 100 MB",
      memberUnderHint: "\u5927\u7684\u5305\u5BFC\u5F97\u6162\uFF0C\u4E5F\u5BB9\u6613\u628A\u62BD\u53D6\u76EE\u5F55\u6491\u6EE1",
      memberReload: "\u91CD\u65B0\u5217\u4E00\u6B21",
      memberPicked: "\u5DF2\u52FE {{count}} \u4E2A \xB7 \u5408\u8BA1 {{size}} \xB7 \u5206 {{batches}} \u6279",
      memberWillBatch: "\u4E00\u6B21\u6700\u591A {{max}} \u4E2A\uFF1A\u4F1A\u5206 {{batches}} \u6279\uFF0C\u4E00\u6279\u4E00\u6279\u95EE\u4F60\u8981\u4E0D\u8981\u7EE7\u7EED",
      memberUnknownSize: "\u5927\u5C0F\u672A\u77E5",
      memberDepth: "\u7B2C {{depth}} \u5C42",
      memberOnDisk: "\u78C1\u76D8\u4E0A\u5C31\u6709",
      memberInArchive: "\u5728\u538B\u7F29\u5305\u91CC",
      memberShowMore: "\u518D\u663E\u793A {{left}} \u6761",
      memberSizeUnknown: "\u6709 {{count}} \u4E2A\u6210\u5458\u8BFB\u4E0D\u51FA\u5927\u5C0F\uFF0C\u5408\u8BA1\u91CC\u6CA1\u7B97\u5B83\u4EEC",
      memberPlanSummary: "\u8FD9\u6279 {{packages}} \u4E2A\u5305\uFF1A\u65B0\u6587\u4EF6 {{fresh}} \u4E2A\uFF1B{{withConflicts}} \u4E2A\u5305\u6709\u51B2\u7A81\uFF0C\u5171 {{entries}} \u4E2A\u6587\u4EF6\u4F1A\u88AB\u8986\u76D6",
      memberBlocked: "\u53E6\u6709 {{count}} \u4E2A\u6210\u5458\u88AB\u6321\u4F4F\uFF0C\u539F\u56E0\u5C31\u5728\u4E0A\u9762",
      memberOneDecision: "\u8FD9\u4E00\u6B21\u51B3\u5B9A\u8986\u76D6\u4E0A\u9762\u8FD9\u6279\u5168\u90E8 {{count}} \u4E2A\u5305\uFF08\u6BCF\u4E2A\u5305\u7684\u8DEF\u5F84\u548C\u51B2\u7A81\u90FD\u5217\u7740\uFF09",
      memberEntries: "{{count}} \u4E2A\u6761\u76EE",
      memberConflicts: "{{count}} \u4E2A\u4F1A\u88AB\u8986\u76D6",
      memberAllFresh: "\u5168\u65B0 {{count}} \u4E2A",
      memberMoreConflicts: "\u8FD8\u6709 {{count}} \u6761\u6CA1\u5217\u51FA\u6765",
      memberOutcome: "\u8FD9\u6279\uFF1A\u6210\u529F {{ok}} \u4E2A\u3001\u5931\u8D25 {{bad}} \u4E2A\u3001\u6CA1\u6267\u884C {{skip}} \u4E2A",
      memberHalfBatch: "\u5931\u8D25\u4E4B\u540E\u5C31\u505C\u624B\u4E86\uFF0C\u6CA1\u7EE7\u7EED\u53D1\uFF1B\u5DF2\u7ECF\u8FDB\u5DE5\u7A0B\u7684\u90FD\u7559\u7740\uFF0C\u53EF\u4EE5\u6574\u6279\u9000\u56DE\u6216\u9010\u6761\u64A4\u9500",
      memberUndoHint: "\u9000\u56DE\u7528\u7684\u662F\u8FD9\u6279\u7684 GUID \u767D\u540D\u5355\uFF0C\u53EA\u5220\u672C\u6B21\u65B0\u5EFA\u7684\uFF1B\u88AB\u8986\u76D6\u53C8\u6CA1\u5907\u4EFD\u7684\u6587\u4EF6\u5185\u5BB9\u627E\u4E0D\u56DE\u6765",
      memberNextBatch: "\u7EE7\u7EED\u4E0B\u4E00\u6279\uFF08\u8FD8\u5269 {{left}} \u6279\uFF09",
      memberStopBatches: "\u5C31\u5BFC\u5230\u8FD9\u513F",
      memberRollbackStopped: "\u5DF2\u9000\u56DE {{done}} \u6761\uFF0C{{left}} \u6761\u505C\u4F4F\u4E86\uFF1B\u6709 {{lost}} \u4E2A\u88AB\u8986\u76D6\u6587\u4EF6\u5F53\u65F6\u6CA1\u5907\u4EFD\u3001\u5185\u5BB9\u627E\u4E0D\u56DE",
      rollbackBatch: "\u6574\u6279\u9000\u56DE",
      pickByProject: "\u56E0\u4E3A\u5DE5\u7A0B\u91CC\u6709\u300C{{matched}}\u300D",
      pickByCollection: "\u56E0\u4E3A\u96C6\u5408\u91CC\u6709\u300C{{matched}}\u300D",
      noteNeedsPassword: "\u8FD9\u4E2A\u5BB9\u5668\u8981\u5BC6\u7801\uFF0C\u6E05\u5355\u53EF\u80FD\u4E0D\u5B8C\u6574",
      noteCappedCount: "\u8FD8\u6709 {{count}} \u4E2A\u6210\u5458\u88AB\u6570\u91CF\u4E0A\u9650\u6321\u5728\u5916\u9762\uFF0C\u6CA1\u5217\u51FA\u6765",
      noteCappedDepth: "\u6709 {{depth}} \u4E2A\u6210\u5458\u592A\u6DF1\uFF08\u8D85\u8FC7\u5C42\u6570\u4E0A\u9650\uFF09\uFF0C\u6CA1\u5217\u51FA\u6765",
      noteNestedArchive: "\u5305\u91CC\u8FD8\u5957\u7740\u538B\u7F29\u5305\uFF1A\u5B83\u53EA\u5904\u7406\u4E00\u5C42\uFF0C\u90A3\u91CC\u9762\u7684\u5305\u770B\u4E0D\u89C1",
      noteListFailed: "\u6709\u4E1C\u897F\u5217\u4E0D\u51FA\u6765\uFF08\u89C1\u4E0A\u9762\u539F\u56E0\uFF09\uFF0C\u8FD9\u4E0D\u4EE3\u8868\u91CC\u9762\u6CA1\u6709\u5305",
      queueRunning: "{{project}} \xB7 \u6B63\u5728\u5BFC\u5165 {{done}}/{{total}}\uFF08\u6210\u529F {{ok}} \xB7 \u5931\u8D25 {{failed}}\uFF09",
      queueDone: "{{project}} \xB7 \u8FD9\u6279\u8DD1\u5B8C\uFF1A\u6210\u529F {{ok}}\u3001\u5931\u8D25 {{failed}}\u3001\u672A\u6267\u884C {{notRun}}",
      queueBusy: "\u5DF2\u6392\u961F\uFF08{{reason}}\uFF09\xB7 \u7B2C {{n}} \u6B21\u91CD\u8BD5 \xB7 {{s}} \u79D2\u540E\u518D\u8BD5",
      qQueued: "\u6392\u961F\u4E2D",
      qRunning: "\u8FDB\u884C\u4E2D",
      qOk: "\u6210\u529F\uFF08\u65B0 {{created}} \xB7 \u8986\u76D6 {{overwritten}}\uFF09",
      qFailed: "\u5931\u8D25",
      qCancelled: "\u5DF2\u53D6\u6D88",
      qNotRun: "\u672A\u6267\u884C",
      importMsgRaw: "{{msg}}",
      qUnknown: "\u7ED3\u679C\u672A\u77E5\uFF08\u6CA1\u7B49\u5230\u7EC8\u6001\uFF09",
      noTargetProject: "\u8FD8\u6CA1\u9009\u5BFC\u5165\u76EE\u6807 \u2014\u2014 \u5728\u9876\u680F\u7684\u5DE5\u7A0B\u5217\u8868\u91CC\u9009\u4E00\u4E2A\u6B63\u5728\u8FD0\u884C\u7684 Unity \u5DE5\u7A0B",
      batchTitle: "\u6279\u91CF\u5BFC\u5165 \xB7 {{count}} \u4E2A\u5305\uFF08\u7B2C {{batch}}/{{batches}} \u6279\uFF09",
      batchSkipped: "{{count}} \u5F20\u5361\u88AB\u8DF3\u8FC7\uFF1A\u5B83\u4EEC\u6709\u597D\u51E0\u4E2A\u5305\uFF0C\u5F97\u5148\u53CC\u51FB\u6253\u5F00\u9762\u677F\u52FE\u8981\u5BFC\u54EA\u4E2A",
      batchNothing: "\u9009\u4E2D\u7684 {{picked}} \u5F20\u5361\u91CC\u6CA1\u6709\u53EF\u76F4\u63A5\u5BFC\u5165\u7684\u5305\uFF08{{skipped}} \u5F20\u8981\u5148\u9009\u5305\uFF09",
      batchBusy: "\u5DF2\u7ECF\u6709\u4E00\u6279\u5728\u8DD1\u4E86\uFF0C\u5148\u628A\u5B83\u5BFC\u5B8C\u6216\u9000\u56DE",
      dimChip: "{{label}} \xD7{{count}}",
      dimMoreHint: "\u8FD8\u6709 {{count}} \u4E2A\u7EF4\u5EA6\u6CA1\u5217\u51FA\u6765",
      dimSuppressed: "\u5404\u4EFD\u53EA\u5DEE\u7248\u672C\uFF0C\u4EF6\u6570\u5DF2\u5199\u5728\u89D2\u4E0A",
      backedUpCount: "\u88AB\u8986\u76D6\u7684\u6587\u4EF6\u5DF2\u5907\u4EFD {{count}} \u4E2A",
      backedUpNothing: "\u6CA1\u4E1C\u897F\u53EF\u5907\u4EFD\uFF1A\u51B2\u7A81\u6846\u8BF4\u4F1A\u76D6\u6389\u7684\u6587\u4EF6\u5176\u5B9E\u4E0D\u5728\u76D8\u4E0A",
      rollbackDeleteFailed: "\uFF1B\u6709 {{count}} \u4E2A\u6CA1\u80FD\u5220\u6389\uFF0C\u5DE5\u7A0B\u91CC\u53EF\u80FD\u8FD8\u7559\u7740",
      setupNeeded: "\u5E93\u8FD8\u6CA1\u914D\u597D\uFF0C\u70B9\u8FD9\u91CC\u7EE7\u7EED\u8BBE\u7F6E",
      dropNoLocalPath: "\u6CA1\u62FF\u5230\u8FD9\u4E9B\u6587\u4EF6\u7684\u672C\u5730\u8DEF\u5F84 \u2014\u2014 \u5B83\u4EEC\u53EF\u80FD\u4E0D\u5728\u78C1\u76D8\u4E0A\uFF08\u6D4F\u89C8\u5668\u91CC\u7684\u56FE\u7247\u3001\u538B\u7F29\u5305\u7A97\u53E3\u91CC\u7684\u4E00\u884C\u90FD\u4F1A\u8FD9\u6837\uFF09\u3002\u8BD5\u8BD5\u4ECE\u8D44\u6E90\u7BA1\u7406\u5668\u62D6\u6587\u4EF6\u5939\u8FDB\u6765\uFF0C\u6216\u7528\u300C\u6536\u4EF6\u7BB1 \u2192 \u9009\u62E9\u6587\u4EF6\u2026\u300D\u3002",
      dropNothing: "\u8FD9\u6B21\u62D6\u62FD\u6CA1\u5E26\u4E0A\u6587\u4EF6 \u2014\u2014 \u53EF\u80FD\u62D6\u7684\u662F\u6587\u5B57\u6216\u5FEB\u6377\u65B9\u5F0F\u3002\u8BD5\u8BD5\u4ECE\u8D44\u6E90\u7BA1\u7406\u5668\u62D6\u6587\u4EF6\u5939\u8FDB\u6765\uFF0C\u6216\u7528\u300C\u6536\u4EF6\u7BB1 \u2192 \u9009\u62E9\u6587\u4EF6\u2026\u300D\u3002",
      importConfirmTitle: "\u786E\u8BA4\u5BFC\u5165\u5230 Unity",
      importConfirmAction: "\u786E\u8BA4\u5BFC\u5165",
      importConfirmIntro: "\u5C06\u5BFC\u5165 {{total}} \u4E2A\u6587\u4EF6\u3002\u6CA1\u6709\u53D1\u73B0\u9700\u8981\u8986\u76D6\u7684\u5DF2\u6709\u6587\u4EF6\u3002",
      memberStartToProject: "\u5C06\u9009\u4E2D\u7684 {{count}} \u9879\u5BFC\u5165\u5230 {{name}}"
    },
    inbox: {
      title: "\u5F85\u6574\u7406\u7684\u7D20\u6750",
      clear: "\u6E05\u7A7A\u5217\u8868",
      pickFiles: "\u9009\u62E9\u6587\u4EF6\u2026",
      stage: {
        queued: "\u6392\u961F\u4E2D",
        hashing: "\u7B97\u6307\u7EB9",
        detecting: "\u8BC6\u522B\u683C\u5F0F",
        extracting: "\u89E3\u538B",
        fingerprinting: "\u8BFB\u5185\u5BB9",
        classifying: "\u5206\u7C7B",
        awaiting_confirm: "\u7B49\u4F60\u786E\u8BA4",
        committing: "\u5165\u5E93",
        done: "\u5B8C\u6210",
        failed: "\u5931\u8D25",
        cancelled: "\u5DF2\u53D6\u6D88",
        duplicate: "\u91CD\u590D"
      },
      active: "\u8FDB\u884C\u4E2D {{count}}",
      m2Note: "\u6DFB\u52A0\u7D20\u6750\u540E\u4F1A\u81EA\u52A8\u8BFB\u53D6\u5185\u5BB9\u5E76\u5EFA\u8BAE\u5206\u7C7B\u3002\u8BF7\u6838\u5BF9\u7ED3\u679C\uFF1B\u4FEE\u6539\u8FC7\u7684\u5206\u7C7B\u4F1A\u7528\u4E8E\u6539\u8FDB\u540E\u7EED\u5224\u65AD\u3002",
      autoExtractOff: "\u5F53\u524D\u4E0D\u81EA\u52A8\u89E3\u538B\uFF08\u53EA\u767B\u8BB0\u539F\u4EF6\u4E0E\u5305\u5185\u6E05\u5355\uFF09",
      confidence: "\u5206\u7C7B\u5339\u914D\u5EA6 {{value}}%",
      why: "\u4E3A\u4EC0\u4E48\u8FD9\u4E48\u5206",
      suspectedSource: "\u7591\u4F3C\u6765\u6E90\uFF1Abooth.pm/items/{{id}}\uFF08\u8981\u786E\u8BA4\uFF09",
      splitInto: "\u8BC6\u522B\u4E3A\u5408\u96C6\uFF0C\u62C6\u6210 {{count}} \u9879 \xB7 {{bundle}}",
      waiting: "\u7B49\u4F60\u786E\u8BA4 {{count}}",
      commitAll: "\u5168\u90E8\u5165\u5E93 ({{count}})",
      commitAllProgress: "\u6B63\u5728\u5165\u5E93 {{done}}/{{total}}",
      commitAllDone: "\u5DF2\u5165\u5E93 {{count}} \u9879",
      commitAllBundles: "\uFF0C{{count}} \u9879\u6309\u5408\u96C6\u767B\u8BB0",
      commitAllFailed: "\uFF0C{{count}} \u9879\u5931\u8D25",
      commitAllMoved: "\u6587\u4EF6\u5DF2\u642C\u8FDB\u5206\u7C7B\u76EE\u5F55",
      commitAllKept: "\u6587\u4EF6\u672A\u79FB\u52A8",
      commitAllUndo: "\u64A4\u9500",
      commitAllAskTitle: "\u786E\u8BA4\u8981\u79FB\u52A8\u6587\u4EF6\u5417\uFF1F",
      commitAllAsk1: "\u5373\u5C06\u628A {{count}} \u4E2A\u7D20\u6750\u79FB\u52A8\u5230\u5E93\u76EE\u5F55\uFF0C\u6D89\u53CA\u7EA6 {{size}} \u7684\u78C1\u76D8\u79FB\u52A8\u3002",
      commitAllAsk2: "\u76EE\u6807\uFF1A{{root}}\\<\u5206\u7C7B>\\<\u5B50\u5206\u7C7B>\\<\u7D20\u6750\u540D>\\",
      commitAllAskHint: "\u79FB\u52A8\u540E\u539F\u4EF6\u4F4D\u7F6E\u4F1A\u53D8\uFF0C\u4E2D\u9014\u51FA\u9519\u65F6\u64A4\u9500\u6210\u672C\u5F88\u9AD8\u3002\u9ED8\u8BA4\u6309\u94AE\u53EA\u767B\u8BB0\u5206\u7C7B\u3001\u4E00\u4E2A\u6587\u4EF6\u90FD\u4E0D\u52A8\u3002",
      commitAllKeepPut: "\u4EC5\u767B\u8BB0\u5206\u7C7B\uFF0C\u4E0D\u79FB\u52A8\u78C1\u76D8",
      commitAllMove: "\u79FB\u52A8\u5E76\u5165\u5E93",
      scopeFiltered: "\u5F53\u524D\u7B5B\u9009\u7ED3\u679C",
      scopeHigh: "\u4EC5\u7F6E\u4FE1\u5EA6 \u2265 {{n}}",
      scopeAll: "\u5168\u90E8\u5F85\u786E\u8BA4\u9879",
      bundleCard: "\u8BC6\u522B\u4E3A\u5408\u96C6 \xB7 \u542B {{count}} \u9879\uFF08\u6574\u5305\u4E00\u5F20\u5361\uFF0C\u4E0D\u62C6\u5F00\uFF09",
      bundleMore: "\u8FD8\u6709 {{count}} \u9879\u2026",
      bundleNoSplit: "\u5165\u5E93\u65F6\u4FDD\u6301\u5728\u4E00\u8D77\uFF0C\u53EA\u767B\u8BB0\u5206\u7C7B\uFF0C\u4E0D\u642C\u52A8\u91CC\u9762\u7684\u6587\u4EF6",
      emptyTitle: "\u5148\u6DFB\u52A0\u4E00\u4E2A\u7D20\u6750\u8BD5\u8BD5",
      emptyHint: "\u628A ZIP\u3001unitypackage \u6216\u7D20\u6750\u6587\u4EF6\u5939\u62D6\u5230\u8FD9\u91CC\uFF0C\u4E5F\u53EF\u4EE5\u70B9\u51FB\u4E0B\u9762\u7684\u6309\u94AE\u3002Atrium \u4F1A\u8BFB\u53D6\u5185\u5BB9\u5E76\u5EFA\u8BAE\u5206\u7C7B\u3002",
      nextStepHint: "\u6DFB\u52A0\u7D20\u6750 \u2192 \u786E\u8BA4\u5206\u7C7B \u2192 \u5728\u300C\u5168\u90E8\u7D20\u6750\u300D\u4E2D\u67E5\u770B\u3002\u8981\u5BFC\u5165 Unity \u65F6\uFF0C\u518D\u9009\u62E9\u5E76\u8FDE\u63A5\u76EE\u6807\u5DE5\u7A0B\u3002"
    },
    unity: {
      errNoProject: "\u5E93\u91CC\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u7A0B\u7684\u8BB0\u5F55\uFF0C\u5148\u5237\u65B0\u5DE5\u7A0B\u5217\u8868",
      errPackageMissing: "\u627E\u4E0D\u5230\u8FD9\u4E2A .unitypackage \u6587\u4EF6\uFF08\u53EF\u80FD\u88AB\u79FB\u8D70\u6216\u5220\u6389\u4E86\uFF09",
      errBridgeMissing: "\u8FD9\u4E2A\u5DE5\u7A0B\u8FD8\u6CA1\u88C5\u6865\u63A5\uFF0C\u88C5\u597D\u624D\u80FD\u5BFC\u5165",
      errNoBridgeHeartbeat: "\u6865\u63A5\u6CA1\u6709\u5FC3\u8DF3\uFF1A\u8FD9\u4E2A\u5DE5\u7A0B\u6CA1\u5F00\u7740 Unity\uFF0C\u6216\u8005\u6865\u63A5\u88AB\u7981\u7528\u4E86",
      errParse: "\u8FD9\u4E2A .unitypackage \u89E3\u6790\u4E0D\u4E86\uFF0C\u53EF\u80FD\u6587\u4EF6\u574F\u4E86\u6216\u8005\u4E0D\u662F\u6807\u51C6\u7684\u5305",
      errResolveFailed: "\u95EE\u4E0D\u5230\u5DE5\u7A0B\u91CC\u5DF2\u6709\u7684\u8D44\u6E90\u6E05\u5355\uFF0C\u5148\u786E\u8BA4 Unity \u8FD8\u5F00\u7740",
      errImportFailed: "Unity \u9000\u56DE\u5931\u8D25",
      bridgeAskSilencedRest: "\u5269\u4E0B {{n}} \u4E2A\u5DE5\u7A0B\u8BB0\u6210\u4E86\u300C\u522B\u518D\u95EE\u300D\u3002\u4EE5\u540E\u60F3\u88C5\uFF0C\u5728\u300C\u5F53\u524D\u5DE5\u7A0B\u300D\u9875\u70B9\u5B89\u88C5\u6865\u63A5\u5C31\u884C"
    },
    project: {
      title: "Unity \u5DE5\u7A0B",
      target: "\u5BFC\u5165\u76EE\u6807",
      noTarget: "\u672A\u9009\u62E9",
      pickTargetHint: "\u9009\u4E00\u4E2A\u5DE5\u7A0B\u4F5C\u4E3A\u5BFC\u5165\u76EE\u6807\u3002\u672A\u8FD0\u884C\u7684\u5DE5\u7A0B\u4E0D\u80FD\u5BFC\u5165\u3002",
      notRunningHint: "\u300C{{name}}\u300D\u6CA1\u5F00\u7740 Unity\uFF0C\u73B0\u5728\u4E0D\u80FD\u5F80\u91CC\u5BFC\u3002\u5148\u6253\u5F00\u5B83\u3002",
      bridgeMissingHint: "\u300C{{name}}\u300D\u8FD8\u6CA1\u88C5\u6865\u63A5\uFF0C\u5BFC\u5165\u524D\u8981\u5148\u88C5\uFF08\u5728\u5DE5\u7A0B\u9875\u70B9\u300C\u5B89\u88C5\u6865\u63A5\u300D\uFF09\u3002",
      compiling: "\u7F16\u8BD1\u4E2D",
      queued: "\u5DF2\u6392\u961F {{count}}",
      manage: "\u7BA1\u7406\u5DE5\u7A0B\uFF08\u5237\u65B0 / \u5B89\u88C5\u6865\u63A5\uFF09\u2026",
      detectNote: "\u8FD0\u884C\u72B6\u6001\u4E09\u8DEF\u53D6\u5E76\u96C6\u5224\u5B9A\uFF1A\u9501\u6587\u4EF6 / \u6865\u63A5\u5FC3\u8DF3 / \u8FDB\u7A0B\u547D\u4EE4\u884C",
      isTarget: "\u5F53\u524D\u5BFC\u5165\u76EE\u6807",
      targetWaiting: "\u7B49\u5F85 Unity \u542F\u52A8",
      setTarget: "\u8BBE\u4E3A\u5BFC\u5165\u76EE\u6807",
      installBridge: "\u5B89\u88C5\u6865\u63A5",
      uninstallBridge: "\u5378\u8F7D\u6865\u63A5",
      installDone: "\u5DF2\u4E3A\u300C{{name}}\u300D\u5B89\u88C5\u6865\u63A5\uFF08{{count}} \u4E2A\u6587\u4EF6\uFF09",
      installAlready: "\u300C{{name}}\u300D\u672C\u6765\u5C31\u88C5\u7740\u6865\u63A5",
      installFailed: "\u5B89\u88C5\u6865\u63A5\u5931\u8D25",
      uninstallDone: "\u5DF2\u5378\u8F7D\u300C{{name}}\u300D\u7684\u6865\u63A5\uFF08\u9001\u8FDB\u56DE\u6536\u7AD9\uFF09",
      uninstallNotInstalled: "\u90A3\u4E2A\u5DE5\u7A0B\u672C\u6765\u5C31\u6CA1\u88C5\u6865\u63A5",
      uninstallFailed: "\u5378\u8F7D\u6865\u63A5\u5931\u8D25",
      staleLockfile: "\u9501\u6587\u4EF6\u662F\u6B8B\u7559\u7684",
      notRunning: "\u672A\u8FD0\u884C",
      running: "\u8FD0\u884C\u4E2D",
      bridgeReady: "\u6865\u63A5\u5DF2\u8FDE\u63A5",
      bridgeMissing: "\u6865\u63A5\u672A\u5B89\u88C5",
      refresh: "\u5237\u65B0\u5DE5\u7A0B\u5217\u8868",
      none: "\u8FD8\u6CA1\u53D1\u73B0\u5DE5\u7A0B\u3002\u5728\u8BBE\u7F6E \u2192 Unity \u91CC\u6307\u5B9A\u5DE5\u7A0B\u6839\u76EE\u5F55\u3002",
      unityVersion: "Unity \u7248\u672C",
      bannerSwitched: "\u5DF2\u8BC6\u522B\u4E3A\u300C{{project}}\u300D\u9879\u76EE \xB7 \u81EA\u52A8\u6253\u5F00 {{collection}} \u96C6\u5408",
      bannerStillSearching: "\u4ECD\u5728\u641C\u7D22\u300C{{q}}\u300D",
      bannerAmbiguous: "\u300C{{project}}\u300D\u540C\u65F6\u547D\u4E2D {{count}} \u4E2A\u96C6\u5408\uFF08{{names}}\uFF09\uFF0C\u6CA1\u6709\u81EA\u52A8\u5207\u6362",
      bannerAmbiguousHint: "\u9009\u4E00\u4E2A\uFF0C\u6216\u8005\u5728\u96C6\u5408\u89C4\u5219\u91CC\u628A\u5B83\u4EEC\u5206\u5F97\u66F4\u5F00",
      bannerNoMatch: "\u68C0\u6D4B\u5230\u300C{{project}}\u300D\xB7 \u6CA1\u5339\u914D\u5230\u96C6\u5408\uFF0C\u89C6\u56FE\u6CA1\u52A8",
      bannerDeferred: "\u68C0\u6D4B\u5230\u300C{{project}}\u300D\xB7 \u8BE5\u5F00 {{collection}} \u96C6\u5408\uFF0C\u4F46\u4F60\u624B\u5934\u6709\u4E8B\uFF0C\u6CA1\u6253\u65AD",
      bannerDeferredHint: "\u5207\u8FC7\u53BB\u4F1A\u6539\u6389\u4F60\u6B63\u5728\u770B\u7684\u5217\u8868\uFF0C\u6240\u4EE5\u53EA\u63D0\u9192\u4E00\u53E5",
      bannerNoOtherCollections: "\u6CA1\u6709\u522B\u7684\u96C6\u5408\u53EF\u9009",
      bannerChooseHint: "\u5DF2\u5207\u5230\u300C{{name}}\u300D\uFF08\u89C4\u5219\u6CA1\u6539\uFF0C\u4E0B\u6B21\u4ECD\u6309\u539F\u89C4\u5219\u5224\u65AD\uFF09",
      bannerRemembered: "\u8BB0\u4F4F\u4E86\uFF1A\u4EE5\u540E\u5F00\u8FD9\u4E2A\u5DE5\u7A0B\u76F4\u63A5\u8FDB\u300C{{name}}\u300D",
      bannerBtn: {
        notThis: "\u4E0D\u662F\u8FD9\u4E2A\u96C6\u5408",
        switchNow: "\u73B0\u5728\u5207\u8FC7\u53BB",
        remember: "\u4EE5\u540E\u90FD\u8FD9\u6837",
        choose: "\u6362\u4E2A\u96C6\u5408",
        pin: "\u56FA\u5B9A",
        ignore: "\u8FD9\u6B21\u5FFD\u7565"
      },
      bannerRuleMissing: "\u90A3\u4E2A\u96C6\u5408\u5DF2\u7ECF\u4E0D\u5728\u4E86\uFF0C\u6CA1\u80FD\u8BB0\u4F4F\uFF08\u5148\u5237\u65B0\u4E00\u4E0B\u96C6\u5408\u5217\u8868\u518D\u8BD5\uFF09",
      bridgeAskTitle: "\u521A\u53D1\u73B0\u5DE5\u7A0B\u300C{{name}}\u300D",
      bridgeAskBody: "\u8FD9\u4E2A\u5DE5\u7A0B\u8FD8\u6CA1\u88C5 Atrium \u7684\u6865\u63A5\u3002\u88C5\u4E86\u5B83\uFF0CAtrium \u624D\u77E5\u9053 Unity \u5F00\u6CA1\u5F00\u3001\u4EC0\u4E48\u65F6\u5019\u5728\u5FD9\u3001\u5BFC\u5165\u80FD\u4E0D\u80FD\u843D\u5730\u3002\u6865\u63A5\u53EA\u653E\u8FDB\u5DE5\u7A0B\u7684 Packages/ \u76EE\u5F55\uFF0C\u4E0D\u52A8 Assets/\u3001\u4E0D\u6539\u4F60\u7684\u573A\u666F\u3002",
      bridgeAskNote: "\u300C\u4EE5\u540E\u90FD\u81EA\u52A8\u5B89\u88C5\u300D\u53EA\u5BF9\u8FD9\u4E2A\u5DE5\u7A0B\u6709\u6548\uFF0C\u4E0D\u662F\u5F00\u673A\u81EA\u542F \u2014\u2014 \u5F00\u673A\u81EA\u542F\u5728\u300C\u8BBE\u7F6E \u2192 \u5E38\u89C4\u300D\u91CC\uFF1B\u300C\u5BF9\u6240\u6709\u5DE5\u7A0B\u90FD\u81EA\u52A8\u88C5\u300D\u7684\u5F00\u5173\u5728\u300C\u8BBE\u7F6E \u2192 Unity\u300D\u3002",
      bridgeAskInstall: "\u5B89\u88C5",
      bridgeAskAlways: "\u4EE5\u540E\u90FD\u81EA\u52A8\u5B89\u88C5\uFF08\u53EA\u8FD9\u4E2A\u5DE5\u7A0B\uFF09",
      bridgeAskNever: "\u4E0D\u518D\u8BE2\u95EE\u6B64\u5DE5\u7A0B",
      bridgeAskMore: "\u53E6\u5916\u8FD8\u6709 {{n}} \u4E2A\u5DE5\u7A0B\u8981\u95EE\uFF0C\u7B54\u5B8C\u8FD9\u6761\u63A5\u7740\u95EE\u4E0B\u4E00\u6761\u3002",
      autoInstalled: "\u5DF2\u81EA\u52A8\u4E3A\u300C{{name}}\u300D\u88C5\u597D\u6865\u63A5\uFF1A{{count}} \u4E2A\u6587\u4EF6 \u2192 {{to}}",
      autoInstallFailed: "\u300C{{name}}\u300D\u81EA\u52A8\u88C5\u6865\u63A5\u6CA1\u6210\u529F\uFF0C\u95EE\u4F60\u4E00\u4E0B\u600E\u4E48\u529E",
      bridgeAskSilenceRest: "\u5269\u4E0B {{n}} \u4E2A\u90FD\u4E0D\u518D\u95EE",
      connectTitle: "\u8FDE\u63A5 Unity \u5DE5\u7A0B",
      connectIntro: "\u60F3\u628A\u7D20\u6750\u4E00\u952E\u5BFC\u5165 Unity\uFF1F\u8BF7\u52FE\u9009\u8981\u8FDE\u63A5\u7684\u5DE5\u7A0B\u3002\u4E5F\u53EF\u4EE5\u5148\u6574\u7406\u7D20\u6750\uFF0C\u7A0D\u540E\u518D\u8FDE\u63A5\u3002",
      connectLater: "\u7A0D\u540E\u8FDE\u63A5",
      connectSelected: "\u8FDE\u63A5\u6240\u9009\u5DE5\u7A0B\uFF08{{n}}\uFF09",
      connectAutomatic: "\u4EE5\u540E\u4E3A\u52FE\u9009\u7684\u5DE5\u7A0B\u81EA\u52A8\u5B89\u88C5\u8FDE\u63A5\u63D2\u4EF6",
      connectFilesNote: "\u8FDE\u63A5\u4F1A\u5728\u5DE5\u7A0B\u7684 Packages \u6587\u4EF6\u5939\u4E2D\u5B89\u88C5 Atrium \u63D2\u4EF6\u3002\u672A\u52FE\u9009\u7684\u5DE5\u7A0B\u672C\u6B21\u8DF3\u8FC7\uFF0C\u4EE5\u540E\u53EF\u5728\u300C\u5F53\u524D\u5DE5\u7A0B\u300D\u4E2D\u624B\u52A8\u8FDE\u63A5\u3002",
      connectionClosed: "Unity \u672A\u6253\u5F00",
      connectionDisabled: "\u5DF2\u505C\u7528\u81EA\u52A8\u8FDE\u63A5",
      connectionUnsupported: "\u6682\u4E0D\u652F\u6301\u6B64 Unity \u7248\u672C",
      connectionInstalling: "\u6B63\u5728\u51C6\u5907\u8FDE\u63A5",
      connectionWaiting: "\u6B63\u5728\u8FDE\u63A5",
      connectionReady: "\u5DF2\u8FDE\u63A5",
      connectionFailed: "\u8FDE\u63A5\u5931\u8D25",
      connectionTimeout: "\u8FDE\u63A5\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      connectionCancelled: "\u5DF2\u53D6\u6D88\u7B49\u5F85\u8FDE\u63A5\u3002",
      connectionProjectMissing: "\u76EE\u6807\u5DE5\u7A0B\u5DF2\u5173\u95ED\u6216\u4E0D\u53EF\u7528\uFF0C\u8BF7\u6253\u5F00 Unity \u540E\u91CD\u8BD5\u3002",
      connectionUnsafe: "\u5DE5\u7A0B\u8DEF\u5F84\u65E0\u6CD5\u5B89\u5168\u5199\u5165\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u53CA\u76EE\u5F55\u94FE\u63A5\u3002",
      chooseImportTarget: "\u9009\u62E9\u5BFC\u5165\u5DE5\u7A0B",
      chooseImportTargetHint: "\u591A\u4E2A Unity \u5DE5\u7A0B\u6B63\u5728\u8FD0\u884C\u3002\u9009\u62E9\u8FD9\u6B21\u5BFC\u5165\u8981\u4F7F\u7528\u7684\u5DE5\u7A0B\uFF0C\u540E\u7EED\u6279\u6B21\u4F1A\u7EE7\u7EED\u4F7F\u7528\u5B83\u3002",
      openUnityHint: "\u6253\u5F00 Unity 2022.3 \u5DE5\u7A0B\u540E\u4F1A\u81EA\u52A8\u8FDE\u63A5\u3002",
      preparingImport: "\u6B63\u5728\u8FDE\u63A5 {{name}}\uFF0C\u5C31\u7EEA\u540E\u7EE7\u7EED\u5BFC\u5165\u2026",
      cancelWaiting: "\u53D6\u6D88\u7B49\u5F85",
      retryConnection: "\u91CD\u8BD5\u8FDE\u63A5",
      connectionAdvanced: "\u9AD8\u7EA7\u8FDE\u63A5\u9009\u9879",
      connectionDetails: "\u67E5\u770B\u8BE6\u7EC6\u539F\u56E0",
      uninstallAutoConnectHint: "\u5378\u8F7D\u540E\u4F1A\u505C\u7528\u6B64\u5DE5\u7A0B\u7684\u81EA\u52A8\u8FDE\u63A5\u3002\u9700\u8981\u65F6\u53EF\u70B9\u51FB\u201C\u91CD\u8BD5\u8FDE\u63A5\u201D\u6062\u590D\u3002",
      connectionOpenUnity: "\u8BF7\u5148\u6253\u5F00 Unity 2022.3 \u5DE5\u7A0B\uFF0C\u518D\u70B9\u51FB\u5BFC\u5165\u3002"
    },
    settings: {
      title: "\u8BBE\u7F6E",
      tabs: {
        general: "\u5E38\u89C4",
        library: "\u5E93",
        classify: "\u5206\u7C7B",
        unity: "Unity",
        integration: "\u96C6\u6210",
        maintenance: "\u7EF4\u62A4",
        about: "\u5173\u4E8E",
        vpm: "\u9879\u76EE\u4E0E\u5305"
      },
      language: "\u754C\u9762\u8BED\u8A00",
      libraryLocale: "\u7269\u7406\u76EE\u5F55\u540D\u8BED\u8A00",
      libraryLocaleHint: "\u5E93\u521B\u5EFA\u540E\u5207\u6362 UI \u8BED\u8A00\u4E0D\u4F1A\u6539\u52A8\u78C1\u76D8\u76EE\u5F55\u540D\uFF0C\u907F\u514D\u76EE\u5F55\u4E71\u5957",
      theme: "\u4E3B\u9898",
      themeDark: "\u6DF1\u8272",
      themeLight: "\u6D45\u8272",
      autoLaunch: "\u5F00\u673A\u81EA\u542F\uFF08\u6700\u5C0F\u5316\u5230\u6258\u76D8\uFF09",
      autoLaunchHint: "Atrium \u5FC5\u987B\u5E38\u9A7B\u6258\u76D8\u624D\u80FD\u611F\u77E5 Unity \u542F\u52A8",
      minimizeToTray: "\u5173\u7A97\u65F6\u7F29\u5230\u6258\u76D8",
      hotkey: "\u5168\u5C40\u6295\u653E\u70ED\u952E",
      libraryRoot: "\u5E93\u6839\u76EE\u5F55",
      libraryRootHint: "\u5F52\u6863\u6A21\u5F0F\u4F1A\u628A\u7D20\u6750\u79FB\u52A8\u5230\u8FD9\u91CC\uFF0C\u5E76\u6309\u5206\u7C7B\u5EFA\u76EE\u5F55",
      storageMode: "\u5B58\u50A8\u6A21\u5F0F",
      modeArchived: "\u5F52\u6863\uFF08\u79FB\u52A8\u8FDB\u5E93\uFF09",
      modeIndexed: "\u7D22\u5F15\uFF08\u6587\u4EF6\u539F\u5730\u4E0D\u52A8\uFF09",
      dirTemplate: "\u76EE\u5F55\u6A21\u677F",
      dirTemplateHint: "\u53EF\u7528 {category} {subcategory} {{name}} {version} {avatar} {author} {year}",
      keepOriginal: "\u4FDD\u7559\u539F\u59CB\u538B\u7F29\u5305",
      autoExtract: "\u81EA\u52A8\u89E3\u538B\u5230 _extracted/",
      autoExtractHint: "\u9ED8\u8BA4\u5173\u95ED\u4EE5\u8282\u7701\u7A7A\u95F4\u3002\u5F00\u542F\u540E\u4F1A\u540C\u65F6\u4FDD\u5B58\u89E3\u538B\u5185\u5BB9\uFF1B\u53EF\u914D\u5408\u300C\u4FDD\u7559\u539F\u59CB\u538B\u7F29\u5305\u300D\u8BBE\u7F6E\u4F7F\u7528\u3002",
      confidenceAuto: "\u81EA\u52A8\u5165\u5E93\u7684\u6700\u4F4E\u5339\u914D\u5EA6",
      confidenceConfirm: "\u65E0\u9700\u786E\u8BA4\u7684\u6700\u4F4E\u5339\u914D\u5EA6",
      grouping: "\u5F00\u542F\u8D44\u4EA7\u5F52\u5E76",
      bundleSplit: "\u5F00\u542F\u5408\u96C6\u62C6\u5206",
      unityExe: "Unity.exe \u8DEF\u5F84",
      projectRoots: "\u5DE5\u7A0B\u6839\u76EE\u5F55",
      detectVcc: "\u4ECE ALCOM / VCC \u6E05\u5355\u8BFB\u53D6",
      confirmBeforeImport: "\u5BFC\u5165\u524D\u786E\u8BA4",
      backupOverwritten: "\u5907\u4EFD\u88AB\u8986\u76D6\u7684\u6587\u4EF6",
      rebuildIndex: "\u4ECE\u4FA7\u8F66\u6587\u4EF6\u91CD\u5EFA\u7D22\u5F15",
      rebuildHint: "\u6570\u636E\u5E93\u635F\u574F\u65F6\u7684\u6551\u547D\u529F\u80FD",
      openAppData: "\u6253\u5F00\u6570\u636E\u76EE\u5F55",
      version: "\u7248\u672C",
      stack: "\u6280\u672F\u6808",
      license: "\u5F00\u6E90\u8BB8\u53EF",
      sevenZip: "\u672C\u7A0B\u5E8F\u4F7F\u7528 7-Zip\uFF08\u4F5C\u8005 Igor Pavlov\uFF09\uFF0C\u9075\u5FAA GNU LGPL \u6388\u6743\u53D1\u5E03\u3002",
      privacy: "\u9690\u79C1\uFF1A\u9664\u4F60\u5728\u300C\u5206\u7C7B\u300D\u91CC\u663E\u5F0F\u914D\u7F6E\u7684 LLM \u670D\u52A1\u5916\uFF0C\u672C\u7A0B\u5E8F\u4E0D\u505A\u4EFB\u4F55\u8054\u7F51\u8BF7\u6C42\u3002\u7D20\u6750\u5185\u5BB9\u4E0D\u4F1A\u79BB\u5F00\u8FD9\u53F0\u673A\u5668\u3002",
      llmWarn: "\u542F\u7528\u540E\uFF0C\u4EC5\u4F4E\u7F6E\u4FE1\u5EA6\u7D20\u6750\u7684\u6587\u4EF6\u6E05\u5355\u4E0E\u8BF4\u660E\u6587\u672C\u4F1A\u88AB\u53D1\u9001\u81F3\u4F60\u914D\u7F6E\u7684\u670D\u52A1\u3002",
      health: "\u5E93\u5065\u5EB7\u68C0\u67E5",
      dataDir: "\u6570\u636E\u76EE\u5F55",
      libraryRootMissing: "\u8FD8\u6CA1\u8BBE\u7F6E\u5E93\u6839\u76EE\u5F55\uFF0C\u6444\u53D6\u4E0E\u5F52\u6863\u90FD\u7528\u4E0D\u4E86",
      llm: "LLM \u515C\u5E95\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09",
      dictionary: "\u8BCD\u5178\u7BA1\u7406",
      bridgeAutoInstall: "\u4E3A\u65B0\u5DE5\u7A0B\u81EA\u52A8\u5B89\u88C5\u6865\u63A5",
      bridgeAutoInstallHint: "\u5F00\u7740\u65F6\uFF1A\u65B0\u53D1\u73B0\u7684\u5DE5\u7A0B\u3001\u4EE5\u53CA\u7B54\u8FC7\u300C\u4EE5\u540E\u90FD\u81EA\u52A8\u5B89\u88C5\u300D\u7684\u5DE5\u7A0B\uFF0C\u4F1A\u5728\u5B83\u51FA\u73B0\u6216 Unity \u6253\u5F00\u5B83\u65F6\u88C5\u4E0A\u6865\u63A5\u3002\u88C5\u4E86\u4EC0\u4E48\u4F1A\u63D0\u793A\u4E00\u53E5\uFF0C\u5DE5\u7A0B\u9875\u4E0A\u80FD\u5378\u8F7D\uFF08\u9001\u8FDB\u56DE\u6536\u7AD9\uFF09\u3002",
      watchedFolders: "\u76D1\u89C6\u6587\u4EF6\u5939",
      watchedFoldersHint: "\u65B0\u6587\u4EF6\u843D\u5730\u540E\u81EA\u52A8\u6444\u53D6\uFF083 \u79D2\u9632\u6296\uFF09",
      contextMenu: "\u8D44\u6E90\u7BA1\u7406\u5668\u53F3\u952E\u83DC\u5355",
      contextMenuInstall: "\u6CE8\u518C\u300C\u53D1\u9001\u5230 Atrium\u300D",
      watchedRunning: "\u76D1\u89C6\u4E2D\uFF1A{{count}} \u4E2A\u76EE\u5F55\uFF08\u4E22\u8FDB\u53BB\u7684\u6587\u4EF6\u4F1A\u81EA\u52A8\u6392\u961F\u6444\u53D6\uFF09",
      contextMenuOn: "\u5DF2\u767B\u8BB0\uFF0C\u6307\u5411 {{exe}}",
      contextMenuOff: "\u8FD8\u6CA1\u767B\u8BB0\u3002\u767B\u8BB0\u540E\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u91CC\u53F3\u952E\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u5C31\u80FD\u770B\u5230\u3002",
      contextMenuLabel: "\u53D1\u9001\u5230 Atrium",
      contextMenuUninstall: "\u79FB\u9664\u53F3\u952E\u83DC\u5355",
      shellMenu: {
        installed: "\u53F3\u952E\u83DC\u5355\u5DF2\u767B\u8BB0",
        uninstalled: "\u53F3\u952E\u83DC\u5355\u5DF2\u79FB\u9664",
        failed: "\u53F3\u952E\u83DC\u5355\u64CD\u4F5C\u5931\u8D25"
      },
      rebuildDone: "\u91CD\u5EFA\u5B8C\u6210",
      dictionaryHint: "\u5185\u7F6E\u8BCD\u5178\u662F\u968F\u7A0B\u5E8F\u5E26\u7684\uFF08\u53EA\u8BFB\uFF09\u3002\u4F60\u5728\u8FD9\u91CC\u52A0\u7684\u8BCD\u6761\u4F18\u5148\u7EA7\u66F4\u9AD8\uFF0C\u4F1A\u7ACB\u523B\u5F71\u54CD\u4E0B\u4E00\u6B21\u5206\u7C7B\u3002",
      userTerms: "\u81EA\u5B9A\u4E49\u8BCD\u6761",
      userTermsHint: "\u5DF2\u6709 {{builtin}} \u6761\u5185\u7F6E\u8BCD\u6761\u3002\u4E0B\u9762\u8FD9\u4E9B\u662F\u4F60\u81EA\u5DF1\u52A0\u7684\uFF0C\u540C\u540D\u65F6\u8986\u76D6\u5185\u7F6E\u3002",
      termPlaceholder: "\u8BCD\u6761\uFF08\u5982 physbone\uFF09",
      termAnySub: "\uFF08\u4E0D\u9650\u4E8C\u7EA7\uFF09",
      termAdd: "\u6DFB\u52A0",
      termAdded: "\u8BCD\u6761\u5DF2\u52A0\u5165",
      termEmpty: "\u8BCD\u6761\u548C\u5206\u7C7B\u90FD\u4E0D\u80FD\u7A7A",
      termBad: "\u8BCD\u6761\u91CC\u6709\u4E0D\u652F\u6301\u7684\u5B57\u7B26",
      learnedRules: "\u5DF2\u5B66\u89C4\u5219",
      learnedRulesHint: "\u4F60\u5728\u5F85\u786E\u8BA4\u91CC\u6539\u8FC7\u4E00\u6B21\u5206\u7C7B\uFF0C\u5B83\u5C31\u8BB0\u4F4F\u8FD9\u4E2A\u7EBF\u7D22\u3002\u5220\u6389\u7B49\u4E8E\u5FD8\u8BB0\u3002",
      learnedEmpty: "\u8FD8\u6CA1\u5B66\u5230\u4E1C\u897F \u2014\u2014 \u6539\u4E00\u6B21\u5206\u7C7B\u5C31\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
      termUnknownCat: "\u5206\u7C7B\u91CC\u627E\u4E0D\u5230\u8FD9\u4E2A\u4E00\u7EA7/\u4E8C\u7EA7\u7EC4\u5408",
      autoArchive: "\u9AD8\u7F6E\u4FE1\u5EA6\u81EA\u52A8\u5F52\u6863",
      autoArchiveHint: "\u5173\u6389\u4E4B\u540E\uFF0C\u4E0D\u7BA1\u7F6E\u4FE1\u5EA6\u591A\u9AD8\u90FD\u4E00\u5F8B\u8FDB\u300C\u5F85\u786E\u8BA4\u300D\uFF0C\u4F60\u4E00\u5F20\u5F20\u70B9\u786E\u8BA4\u624D\u642C\u6587\u4EF6\u3002\u7B2C\u4E00\u6B21\u6536\u7F16\u6574\u5E93\u65F6\u5EFA\u8BAE\u5148\u5173\u3002",
      reclaimTitle: "\u6536\u7F16\u5DF2\u6709\u7684\u5E93",
      reclaimHint: "\u8BBE\u7F6E \u2192 \u7EF4\u62A4 \u2192 \u5E93\u5065\u5EB7\u68C0\u67E5 \u2192 \u626B\u63CF\uFF0C\u518D\u70B9\u300C\u91CD\u65B0\u767B\u8BB0\u300D\u3002\u5B83\u4F1A\u6309\u76EE\u5F55\u5C42\u7EA7\u628A\u6CA1\u767B\u8BB0\u7684\u7D20\u6750\u4E22\u8FDB\u53D6\u7269\u961F\u5217\uFF0C\u8D70\u7684\u8FD8\u662F\u89E3\u538B \u2192 \u5206\u7C7B \u2192 \u5F52\u5E76\u90A3\u5957\uFF0C\u4E0D\u662F\u539F\u6837\u9501\u8FDB\u5E93\u3002",
      rebundle: "\u91CD\u65B0\u6574\u7406\u5408\u96C6",
      rebundleHint: "\u4E0A\u4E00\u7248\u628A\u5408\u96C6\u62C6\u6210\u4E86\u4E00\u5806\u9876\u5C42\u7D20\u6750\u3002\u8FD9\u91CC\u53EA\u8BFB\u626B\u63CF\u51FA\u300C\u540C\u4E00\u76EE\u5F55\u91CC\u7684\u90A3\u51E0\u4EF6\u300D\uFF0C\u9884\u89C8\u786E\u8BA4\u540E\u5438\u56DE\u6210\u5408\u96C6\uFF1A\u4E0D\u642C\u4E00\u4E2A\u6587\u4EF6\uFF0C\u53EF Ctrl+Z\u3002",
      rebundleScan: "\u626B\u63CF\u53EF\u5F52\u5E76\u7684\u7EC4",
      rebundleApply: "\u6574\u7406\u8FD9 {{count}} \u7EC4",
      rebundleNone: "\u6CA1\u6709\u53EF\u5F52\u5E76\u7684\u7EC4",
      rebundleDone: "\u5DF2\u5F52\u5E76\uFF1A{{bundles}} \u4E2A\u5408\u96C6 / {{moved}} \u9879\u6539\u6302 / {{versions}} \u6761\u7248\u672C\u884C",
      rebundleFromTo: "{{from}} \u4E2A\u7D20\u6750 \u2192 {{to}} \u4E2A\u5B50\u9879",
      rebundleWhyVersions: "\u540C\u76EE\u5F55 + \u591A\u4E2A\u7248\u672C",
      rebundleWhyContainer: "\u540C\u76EE\u5F55\uFF0C\u4E14\u76EE\u5F55\u540D\u662F\u5BB9\u5668\u540D",
      regroup: "\u62C6\u5F00\u8DE8\u76EE\u5F55\u7684\u5F52\u5E76\u7EC4",
      regroupHint: "\u5F52\u5E76\u7684\u524D\u63D0\u662F\u300C\u540C\u4E00\u7236\u5BB9\u5668\uFF08\u540C\u76EE\u5F55\uFF09\u300D\u3002\u65E9\u671F\u7248\u672C\u53EA\u6309\u5F52\u5E76\u952E\u5206\u7EC4\uFF0C\u628A\u4E0D\u540C\u76EE\u5F55\u4E0B\u7684\u540C\u540D\u4E1C\u897F\u5E76\u6210\u4E86\u4E00\u5F20\u5361\u3002\u8FD9\u91CC\u53EA\u8BFB\u626B\u51FA\u90A3\u4E9B\u7EC4\uFF0C\u6309\u76EE\u5F55\u5404\u62C6\u4E00\u4EFD\uFF1A\u4E0D\u642C\u4E00\u4E2A\u6587\u4EF6\uFF0C\u53EF Ctrl+Z\u3002",
      regroupScan: "\u626B\u63CF\u8DE8\u76EE\u5F55\u7684\u7EC4",
      regroupApply: "\u62C6\u5F00\u8FD9 {{count}} \u7EC4",
      regroupNone: "\u6CA1\u6709\u8DE8\u76EE\u5F55\u8BEF\u5E76\u7684\u7EC4",
      regroupDone: "\u5DF2\u62C6\u5F00\uFF1A{{groups}} \u7EC4 / {{moved}} \u884C\u6539\u6302",
      regroupScanned: "\u626B\u4E86 {{scanned}} \u4E2A\u7EC4\uFF0C\u4F1A\u52A8 {{affected}} \u884C",
      regroupSplitBadge: "{{from}} \u4E2A \u2192 {{to}} \u7EC4",
      regroupKeptTitle: "\u53E6\u5916 {{count}} \u7EC4\u4FDD\u6301\u5F52\u5E76\uFF08\u4E0D\u7B97\u8BEF\u5E76\uFF09",
      regroupKeptBadge: "\u4FDD\u6301",
      regroupKeptWhy: "\u8FD9\u4E9B\u662F\u540C\u4E00\u4E2A\u4EA7\u54C1\u7684\u538B\u7F29\u5305\u4E0E\u5B83\u7684\u5DF2\u89E3\u538B\u526F\u672C\uFF0C\u53EA\u662F\u8EBA\u5728\u4E24\u4E2A\u76EE\u5F55\u91CC \u2014\u2014 \u6309\u65E2\u5B9A\u89C4\u5219\u5E94\u5F53\u4ECD\u662F\u4E00\u5F20\u5361\uFF0C\u6240\u4EE5\u6CA1\u52A8\u5B83\u4EEC\u3002",
      learnTitle: "\u4ECE\u5E93\u4E2D\u5B66\u4E60\u6A21\u578B\u540D",
      learnWhy: "\u626B\u63CF\u5E93\u91CC <\u6A21\u578B>_<\u7CFB\u5217> \u5F62\u5F0F\u7684\u6587\u4EF6\u540D\uFF0C\u628A\u53CD\u590D\u51FA\u73B0\u3001\u4F46\u8BCD\u5178\u8FD8\u4E0D\u8BA4\u8BC6\u7684\u540D\u5B57\u5217\u51FA\u6765\u3002\u52A0\u8FDB\u8BCD\u5178\u4E4B\u540E\uFF0C\u540C\u7C7B\u7D20\u6750\u5C31\u80FD\u81EA\u52A8\u5F52\u5E76\u3001\u8BE6\u60C5\u9875\u4E5F\u80FD\u663E\u793A\u6A21\u578B\u5FBD\u7AE0\u3002",
      learnScan: "\u626B\u63CF\u5E93",
      learnScanning: "\u626B\u63CF\u4E2D\u2026",
      learnFound: "\u53D1\u73B0 {{count}} \u4E2A\u7591\u4F3C\u6A21\u578B\u540D",
      learnNone: "\u6CA1\u6709\u53D1\u73B0\u65B0\u7684\u7591\u4F3C\u6A21\u578B\u540D\uFF0C\u8BCD\u5178\u5DF2\u7ECF\u591F\u7528\u4E86",
      learnAdd: "\u52A0\u5165\u8BCD\u5178",
      learnAdded: "\u5DF2\u52A0\u5165 {{count}} \u4E2A\u8BCD\u6761",
      learnSeries: "\u7CFB\u5217",
      learnFreq: "\u51FA\u73B0",
      learnThresholdNote: "\u53EA\u5217\u540C\u4E00\u7CFB\u5217\u4E0B\u51FA\u73B0 \u22652 \u6B21\u7684\u540D\u5B57\uFF1B\u5355\u4E2A\u7CFB\u5217\u91CC 20 \u4E2A\u4E0D\u540C\u6A21\u578B\u5404\u51FA\u73B0 1 \u6B21\u65F6\uFF0C\u6309\u7CFB\u5217\u6574\u7EC4\u5217\u51FA\uFF08\u771F\u5E93\u7684 ATTITUDE The Royal Bunny \u5C31\u662F\u8FD9\u6837\uFF09",
      reanalyzeTitle: "\u91CD\u65B0\u5206\u6790\u5DF2\u5165\u5E93\u7684\u6570\u636E",
      reanalyzeWhy: "\u6539\u4E86\u547D\u540D / \u7248\u672C\u53F7 / \u65B9\u62EC\u53F7\u5F52\u5E76\u89C4\u5219\u4E4B\u540E\uFF0C\u5E93\u91CC\u90A3\u4E9B\u6309\u65E7\u89C4\u5219\u7B97\u51FA\u6765\u7684\u540D\u5B57\u8981\u91CD\u7B97\u4E00\u904D\u3002\u8FD9\u4E00\u6B65**\u53EA\u6539\u5E93\u91CC\u7684\u5217\uFF0C\u4E00\u4E2A\u6587\u4EF6\u90FD\u4E0D\u79FB\u52A8**\uFF1B\u6309\u4E0B\u4E4B\u524D\u5148\u544A\u8BC9\u4F60\u4F1A\u5F71\u54CD\u591A\u5C11\u6761\uFF0C\u4E4B\u540E\u8FD8\u80FD\u6574\u6279 Ctrl+Z \u9000\u56DE\u3002",
      reanalyzeScan: "\u5148\u770B\u770B\u4F1A\u5F71\u54CD\u591A\u5C11\u6761",
      reanalyzeScanning: "\u626B\u63CF\u4E2D\u2026",
      reanalyzeAffected: "\u5171 {{scanned}} \u6761\u8BB0\u5F55\uFF0C\u5176\u4E2D {{affected}} \u6761\u4F1A\u88AB\u6539",
      reanalyzeRenamed: "{{count}} \u6761\u4F1A\u6539\u540D",
      reanalyzeUuid: "{{count}} \u6761\u540D\u5B57\u91CC\u8FD8\u6302\u7740 UUID",
      reanalyzeJunk: "{{count}} \u6761\u662F\u5783\u573E\u6587\u4EF6\uFF0C\u5EFA\u8BAE\u8BF7\u51FA\u5E93",
      reanalyzeClean: "\u5168\u90E8 {{scanned}} \u6761\u90FD\u7B26\u5408\u65B0\u89C4\u5219\uFF0C\u4E0D\u7528\u91CD\u7B97",
      reanalyzeApply: "\u91CD\u65B0\u5206\u6790\u8FD9 {{count}} \u6761",
      reanalyzeDropJunk: "\u8BF7\u51FA\u8FD9 {{count}} \u6761\u5783\u573E\u8BB0\u5F55",
      reanalyzeDone: "\u5DF2\u91CD\u7B97 {{count}} \u6761\uFF08\u78C1\u76D8\u6587\u4EF6\u672A\u52A8\uFF09",
      reanalyzeJunkDone: "\u5DF2\u79FB\u9664 {{count}} \u6761\u8BB0\u5F55\uFF0C\u78C1\u76D8\u4E0A\u7684\u6587\u4EF6\u8FD8\u5728\u539F\u5730",
      reanalyzeColName: "\u5C55\u793A\u540D",
      reanalyzeColVersion: "\u7248\u672C",
      reanalyzeColFields: "\u6539\u7684\u5217",
      reanalyzeNone: "\u6CA1\u6709\u9700\u8981\u91CD\u7B97\u7684\u8BB0\u5F55",
      reanalyzeDemote: "\u5176\u4E2D {{count}} \u6761\u662F\u65E7\u89C4\u5219\u767B\u8BB0\u6210\u72EC\u7ACB\u7D20\u6750\u7684\u4ECB\u7ECD\u56FE\uFF0C\u5C06\u88AB\u964D\u7EA7\u6210\u9644\u5C5E\u884C",
      reanalyzeDemoteApply: "\u964D\u7EA7\u8FD9 {{count}} \u6761\u9644\u5C5E\u884C",
      extractRoot: "\u62BD\u53D6\u76EE\u5F55",
      extractRootHint: "\u4ECE\u538B\u7F29\u5305\u91CC\u53D6 .unitypackage \u65F6\u7684\u4E34\u65F6\u843D\u811A\u5904\u3002\u7559\u7A7A = \u81EA\u52A8\u7528\u5E93\u6839\u7684\u5144\u5F1F\u76EE\u5F55\uFF08\u5E93\u5728 E:\\vrc\\A \u5C31\u662F E:\\vrc\\A__extract\uFF09\u3002\u4E0D\u8BB8\u653E\u5728\u7D20\u6750\u5E93\u91CC\uFF0C\u4E5F\u4E0D\u8BB8\u653E\u5728 C \u76D8\uFF1B\u7528\u5B8C\u5373\u5220\uFF0C\u5F00\u673A\u8FD8\u4F1A\u518D\u6E05\u4E00\u6B21\u3002",
      extractRootPlaceholder: "\u7559\u7A7A = \u81EA\u52A8\u653E\u5728\u5E93\u6839\u65C1\u8FB9\u7684 A__extract\uFF08\u548C\u5E93\u540C\u4E00\u4E2A\u76D8\uFF09",
      autoSwitchBehavior: "\u81EA\u52A8\u5F39\u51FA\u884C\u4E3A",
      autoSwitchBehaviorHint: "\u68C0\u6D4B\u5230\u67D0\u4E2A Unity \u5DE5\u7A0B\u521A\u6253\u5F00\u65F6\uFF0C\u5B83\u8BE5\u505A\u4EC0\u4E48",
      asbAlways: "\u6BCF\u6B21\u90FD\u5F39\u51FA\u4E3B\u7A97\u53E3",
      asbWhenMatched: "\u4EC5\u5F53\u5339\u914D\u5230\u96C6\u5408\u65F6\uFF08\u63A8\u8350\uFF09",
      asbNever: "\u4ECE\u4E0D\uFF0C\u53EA\u66F4\u65B0\u9876\u680F\u72B6\u6001",
      trayRequiredNote: "Atrium \u53EA\u6709\u5F00\u7740\u624D\u80FD\u611F\u77E5 Unity \u542F\u52A8\uFF1A\u5173\u5230\u6258\u76D8\u65F6\u7167\u5E38\u5DE5\u4F5C\uFF0C\u5F7B\u5E95\u9000\u51FA\u540E\u4E0D\u4F1A\u81EA\u52A8\u5207\u6362\u3002\u300C\u5F00\u673A\u81EA\u542F\u300D\u548C\u300C\u5173\u7A97\u53E3\u6536\u8FDB\u6258\u76D8\u300D\u662F\u4E24\u4EF6\u4E8B\uFF0C\u5404\u5728\u4E0A\u9762\u5BF9\u5E94\u7684\u4F4D\u7F6E\u8BBE\u7F6E\u3002",
      autoLaunchAskTitle: "\u8981\u8BA9 Atrium \u5F00\u673A\u5E38\u9A7B\u6258\u76D8\u5417\uFF1F",
      autoLaunchAskBody: "\u521A\u68C0\u6D4B\u5230\u4F60\u6253\u5F00\u4E86 Unity \u5DE5\u7A0B\u3002Atrium \u5FC5\u987B\u5F00\u7740\u624D\u80FD\u81EA\u52A8\u5207\u5230\u5BF9\u5E94\u96C6\u5408 \u2014\u2014 \u52FE\u4E86\u5F00\u673A\u81EA\u542F\uFF0C\u4E0B\u6B21\u767B\u5F55 Windows \u5B83\u5C31\u5728\u6258\u76D8\u91CC\u7B49\u7740\u3002\u4E0D\u52FE\u4E5F\u884C\uFF0C\u624B\u52A8\u6253\u5F00 Atrium \u4E00\u6837\u80FD\u81EA\u52A8\u5207\u3002",
      autoLaunchAskYes: "\u5F00\u673A\u81EA\u542F",
      autoLaunchAskNo: "\u4E0D\u7528\u4E86",
      synonymsTitle: "\u5206\u7C7B\u53E3\u8BED\u53EB\u6CD5",
      synonymsHint: "\u4F60\u5E73\u65F6\u600E\u4E48\u53EB\u8FD9\u4E00\u7C7B\u4E1C\u897F\uFF0C\u5C31\u5199\u8FDB\u6765\u3002\u641C\u300C\u8863\u670D\u300D\u80FD\u627E\u5230\u5F52\u5728\u300C\u670D\u88C5\u300D\u91CC\u7684\u7D20\u6750\uFF0C\u9760\u7684\u5C31\u662F\u8FD9\u91CC\uFF0C\u4E0D\u662F\u7A0B\u5E8F\u91CC\u5199\u6B7B\u7684\u8BCD\u8868\u3002",
      synonymsKanjiHint: "\u65E5\u8BED\u6C49\u5B57\u539F\u540D\uFF08\u4F8B\u5982\u300C\u675F\u7E1B\u300D\uFF09\u7528\u7F57\u9A6C\u5B57 sokubaku \u641C\u4E0D\u5230\uFF1A\u90A3\u8981\u6302\u51E0 MB \u7684\u6C49\u5B57\u8BFB\u97F3\u8BCD\u5178\uFF0C\u800C\u4E14\u591A\u97F3\u5B57\u7167\u6837\u9519\uFF0C\u6240\u4EE5\u5B83\u4E0D\u505A\u3002\u628A\u539F\u540D\u6574\u6BB5\u5199\u8FDB\u7D20\u6750\u5907\u6CE8\uFF0C\u5C31\u80FD\u641C\u5230\u4E86\u3002",
      synonymsAddPh: "\u52A0\u4E00\u4E2A\u53E3\u8BED\u53EB\u6CD5",
      synonymsAdd: "\u6DFB\u52A0",
      synonymsSaved: "\u5DF2\u4FDD\u5B58\uFF0C\u68C0\u7D22\u7D22\u5F15\u5DF2\u7ECF\u8DDF\u7740\u91CD\u5EFA",
      synonymsRevert: "\u653E\u5F03\u4FEE\u6539",
      synonymsUnsaved: "\u6709\u6539\u52A8\u6CA1\u4FDD\u5B58",
      synonymsNone: "\uFF08\u8FD8\u6CA1\u6709\u53E3\u8BED\uFF09",
      synonymDeadWarn: "\u5355\u5B57\u8BCD\u5728\u68C0\u7D22\u91CC\u4F1A\u88AB\u4E22\u6389\uFF08\u547D\u4E2D\u9762\u592A\u5BBD\uFF09\uFF0C\u5199\u4E24\u4E2A\u5B57\u4EE5\u4E0A\u624D\u6709\u7528",
      synonym: {
        empty: "\u6CA1\u5199\u8BCD",
        tooShort: "\u81F3\u5C11\u8981 {{min}} \u4E2A\u5B57 \u2014\u2014 \u5355\u5B57\u8BCD\u5728\u68C0\u7D22\u91CC\u4F1A\u88AB\u76F4\u63A5\u4E22\u6389\uFF0C\u5199\u4E86\u4E5F\u662F\u767D\u5199",
        tooLong: "\u300C{{word}}\u300D\u592A\u957F\uFF08\u6700\u591A {{max}} \u4E2A\u5B57\u7B26\uFF09",
        dup: "\u300C{{word}}\u300D\u5DF2\u7ECF\u5728\u4E86",
        tooMany: "\u4E00\u4E2A\u5206\u7C7B\u6700\u591A {{max}} \u6761\u53E3\u8BED\uFF0C\u5148\u5220\u51E0\u6761"
      },
      vaultTitle: "\u5DF2\u8BB0\u4F4F\u7684\u5BC6\u7801",
      vaultHint: "\u8FD9\u4E9B\u662F\u52FE\u4E86\u300C\u8BB0\u4F4F\u8FD9\u4E2A\u5BC6\u7801\u300D\u7684\u52A0\u5BC6\u5305\u3002\u8FD9\u91CC\u4E0D\u663E\u793A\u5BC6\u7801\u672C\u8EAB\uFF0C\u53EA\u80FD\u5220\u3002",
      vaultUnavailable: "\u8FD9\u53F0\u673A\u5668\u7684\u7CFB\u7EDF\u52A0\u5BC6\u73B0\u5728\u4E0D\u53EF\u7528\uFF0C\u6240\u4EE5\u5B58\u4E0D\u4E86\u65B0\u5BC6\u7801\uFF1B\u4E0B\u9762\u5DF2\u6709\u7684\u90A3\u4E9B\u4E5F\u53EF\u80FD\u89E3\u4E0D\u5F00\u3002",
      vaultEmpty: "\u4E00\u6761\u90FD\u6CA1\u6709\u3002",
      vaultUnreadable: "\u89E3\u4E0D\u5F00",
      vaultUnreadableHint: "\u6362\u8FC7\u673A\u5668\u6216\u6362\u8FC7 Windows \u8D26\u6237\u4E4B\u540E\u5C31\u4F1A\u8FD9\u6837\uFF08\u52A0\u5BC6\u7ED1\u5B9A\u5F53\u524D\u7528\u6237\uFF09\u3002\u8FD9\u6761\u7559\u7740\u4E5F\u6CA1\u7528\u4E86\uFF0C\u53EF\u4EE5\u5220\u6389\u3002",
      remerge: "\u628A\u540C\u4E00\u4EF6\u8863\u670D\u91CD\u65B0\u5E76\u6210\u4E00\u5F20\u5361",
      remergeFieldHint: "\u65E9\u5148\u6536\u8FDB\u6765\u7684\u4E1C\u897F\uFF0C\u5F52\u5E76\u89C4\u5219\u540E\u6765\u6539\u8FC7\u4E86\u3002\u5347\u7EA7\u540E\u7B2C\u4E00\u6B21\u542F\u52A8\u65F6\u7A0B\u5E8F\u4F1A\u81EA\u5DF1\u6309\u73B0\u5728\u7684\u89C4\u5219\u91CD\u7B97\u4E00\u904D\u5206\u7EC4\uFF0C\u4E00\u4E2A\u6587\u4EF6\u90FD\u4E0D\u632A\uFF1B\u8FD9\u4E00\u680F\u662F\u7ED9\u4F60\u60F3\u518D\u624B\u52A8\u68C0\u67E5\u4E00\u6B21\u65F6\u7528\u7684\u3002",
      remergeHint: "\u5148\u70B9\u300C\u68C0\u67E5\u4E00\u904D\u300D\uFF0C\u770B\u6E05\u8981\u5408\u5E76\u4EC0\u4E48\u518D\u51B3\u5B9A\u3002\u505A\u5B8C\u53EF\u4EE5\u6309 Ctrl+Z \u6574\u6279\u9000\u56DE\u3002",
      remergeScan: "\u68C0\u67E5\u4E00\u904D",
      remergeApply: "\u5408\u5E76\uFF08{{count}} \u5904\uFF09",
      remergeNone: "\u6CA1\u6709\u9700\u8981\u91CD\u5E76\u7684 \u2014\u2014 \u5E93\u91CC\u6BCF\u4E00\u7EC4\u90FD\u548C\u73B0\u5728\u7684\u89C4\u5219\u4E00\u81F4",
      remergeScanned: "\u770B\u4E86 {{scanned}} \u5F20\u5361\uFF0C\u5176\u4E2D {{moved}} \u5F20\u4F1A\u632A\u5230\u522B\u7684\u5361\u4E0B\u9762",
      remergeAmbiguous: "\u53E6\u6709 {{count}} \u5904\u540D\u5B57\u592A\u50CF\u3001\u4E0D\u6562\u81EA\u52A8\u5E76\uFF0C\u7559\u7ED9\u4F60\u81EA\u5DF1\u5224\u65AD",
      remergeDone: "\u5408\u5E76\u5B8C\uFF1A{{clusters}} \u5904 / \u632A\u4E86 {{moved}} \u5F20\u5361 / \u6E05\u6389 {{groups}} \u4E2A\u7A7A\u5206\u7EC4",
      remergeBadge: "{{from}} \u5F20\u5E76\u6210 1 \u5F20",
      remergeNewGroup: "\u8981\u65B0\u5EFA\u4E00\u7EC4",
      remergeMore: "\u8FD8\u6709 {{count}} \u5F20\u6CA1\u5217\u51FA\u6765",
      openLogDir: "\u6253\u5F00\u65E5\u5FD7\u4F4D\u7F6E",
      invalidThreshold: "\u5206\u7C7B\u5339\u914D\u5EA6\u5FC5\u987B\u5728 0 \u5230 1 \u4E4B\u95F4\u3002",
      keepOriginalHint: "\u5173\u95ED\u540E\uFF0C\u4EC5\u5728\u81EA\u52A8\u89E3\u538B\u5185\u5BB9\u5DF2\u4FDD\u5B58\u65F6\uFF0C\u5C06\u539F\u538B\u7F29\u5305\u79FB\u5165\u53EF\u64A4\u9500\u6682\u5B58\u533A\u3002\u672A\u89E3\u538B\u3001\u89E3\u538B\u5931\u8D25\u548C\u539F\u59CB unitypackage \u90FD\u4F1A\u4FDD\u7559\u3002",
      confidenceAutoHint: "0\u20131\uFF1B\u8FBE\u5230\u6B64\u5339\u914D\u5EA6\u4E14\u65E0\u9700\u786E\u8BA4\u65F6\uFF0C\u53EF\u81EA\u52A8\u5165\u5E93\u3002\u6570\u503C\u8D8A\u5927\u8D8A\u8C28\u614E\u3002",
      confidenceConfirmHint: "0\u20131\uFF1B\u4F4E\u4E8E\u6B64\u5339\u914D\u5EA6\u65F6\uFF0C\u5FC5\u987B\u624B\u52A8\u786E\u8BA4\u5206\u7C7B\u3002",
      databaseBackup: "\u5907\u4EFD\u6570\u636E\u5E93",
      databaseBackupHint: "\u4FDD\u5B58\u4E00\u4EFD\u5F53\u524D\u6570\u636E\u5E93\u7684\u5B8C\u6574\u526F\u672C\uFF0C\u5305\u542B\u7D20\u6750\u7D22\u5F15\u3001\u5206\u7C7B\u3001\u96C6\u5408\u548C\u5BFC\u5165\u5386\u53F2\u3002\u7D20\u6750\u539F\u6587\u4EF6\u3001\u7F29\u7565\u56FE\u3001\u5DE5\u7A0B\u6587\u4EF6\u53CA\u5BFC\u5165\u524D\u7684\u6587\u4EF6\u5907\u4EFD\u4E0D\u5305\u542B\u5728\u5185\uFF1B\u590D\u5236\u5230\u5176\u4ED6\u7535\u8111\u540E\uFF0C\u4FDD\u5B58\u7684\u5BC6\u7801\u53EF\u80FD\u65E0\u6CD5\u89E3\u5BC6\u3002",
      backupChoose: "\u9009\u62E9\u4F4D\u7F6E\u5E76\u5907\u4EFD\u2026",
      backupSaving: "\u6B63\u5728\u5907\u4EFD\u2026",
      backupDone: "\u6570\u636E\u5E93\u5907\u4EFD\u5DF2\u4FDD\u5B58",
      backupShow: "\u67E5\u770B\u5907\u4EFD\u6587\u4EF6",
      backupBusy: "\u6570\u636E\u5E93\u6B63\u5728\u5907\u4EFD\uFF0C\u8BF7\u7A0D\u5019\u3002",
      backupProtectLiveDatabase: "\u4E0D\u80FD\u628A\u5907\u4EFD\u4FDD\u5B58\u5230\u5F53\u524D\u6570\u636E\u5E93\u6216\u5B83\u7684\u65E5\u5FD7\u6587\u4EF6\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6\u6587\u4EF6\u540D\u3002",
      backupInvalidTarget: "\u8FD9\u4E2A\u4F4D\u7F6E\u4E0D\u80FD\u4FDD\u5B58\u5907\u4EFD\uFF0C\u8BF7\u9009\u62E9\u4E00\u4E2A\u6709\u6548\u7684\u6587\u4EF6\u8DEF\u5F84\u3002",
      backupFailed: "\u6570\u636E\u5E93\u5907\u4EFD\u5931\u8D25\u3002\u5DF2\u6709\u7684\u76EE\u6807\u6587\u4EF6\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u68C0\u67E5\u7A7A\u95F4\u3001\u6743\u9650\u6216\u6587\u4EF6\u662F\u5426\u6B63\u88AB\u5360\u7528\u3002",
      backupTargetJournal: "\u76EE\u6807\u6587\u4EF6\u65C1\u8FB9\u5B58\u5728\u6570\u636E\u5E93\u65E5\u5FD7\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8986\u76D6\u3002\u8BF7\u9009\u62E9\u65B0\u7684\u5907\u4EFD\u6587\u4EF6\u540D\u3002",
      unityAutoConnect: "\u81EA\u52A8\u8FDE\u63A5 Unity",
      unityAutoConnectHint: "\u6253\u5F00\u53D7\u652F\u6301\u7684 Unity \u5DE5\u7A0B\u65F6\u81EA\u52A8\u51C6\u5907\u8FDE\u63A5\u3002\u9996\u6B21\u7F3A\u5C11\u63D2\u4EF6\u65F6\u81EA\u52A8\u5B89\u88C5\uFF0C\u8FDE\u63A5\u5C31\u7EEA\u540E\u624D\u6267\u884C\u4F60\u53D1\u8D77\u7684\u5BFC\u5165\u3002"
    },
    toast: {
      trashDone: "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",
      inboxRestored: "\u6536\u4EF6\u7BB1\u6062\u590D\u4E86 {{count}} \u9879\uFF08\u4E0A\u6B21\u6CA1\u786E\u8BA4\u5B8C\u7684\uFF09\uFF0C\u5DF2\u91CD\u65B0\u626B\u63CF\uFF0C\u8BF7\u7EE7\u7EED\u786E\u8BA4\u5206\u7C7B",
      undoNone: "\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C",
      saved: "\u5DF2\u4FDD\u5B58",
      error: "\u51FA\u9519\u4E86",
      undoDone: "\u5DF2\u64A4\u9500",
      trashCount: "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9\uFF1A{{count}} \u9879",
      undoSteps: "\u5DF2\u64A4\u9500 {{steps}} \u6B65\uFF1A\u642C\u56DE {{moved}} \u9879\u3001\u6E05\u6389 {{dirs}} \u4E2A\u7A7A\u76EE\u5F55\u3001\u79FB\u9664 {{assets}} \u6761\u8BB0\u5F55",
      undoStopped: "\u64A4\u9500\u5728\u7B2C {{step}} \u6B65\u505C\u4E0B\uFF1A{{error}}",
      learnedNow: "\u5DF2\u7ECF\u5B66\u4F1A {{rules}} \u6761\u89C4\u5219\uFF0C\u4E0B\u6B21\u5E26\u300C{{token}}\u300D\u7684\u4E1C\u897F\u4F1A\u7167\u8FD9\u4E2A\u5206",
      undoRearchived: "\u5DF2\u64A4\u9500 {{steps}} \u6B65\uFF1A{{moved}} \u9879\u6587\u4EF6\u642C\u56DE\u539F\u4F4D\u3001{{assets}} \u6761\u8BB0\u5F55\u6539\u56DE\u539F\u6837\uFF08\u7D20\u6750\u8BB0\u5F55\u6CA1\u88AB\u5220\uFF09",
      undoStale: "\u90A3\u4E00\u6B65\u4E4B\u540E\u4F60\u53C8\u505A\u4E86\u522B\u7684\u64CD\u4F5C\uFF0C\u8FD9\u6B21\u64A4\u9500\u5DF2\u7ECF\u8FC7\u671F\uFF0C\u6211\u4EC0\u4E48\u90FD\u6CA1\u52A8",
      undoRemerged: "\u5DF2\u64A4\u9500\u8FD9\u6B21\u5408\u5E76\uFF1A{{cards}} \u5F20\u5361\u56DE\u5230\u81EA\u5DF1\u539F\u6765\u7684\u4F4D\u7F6E\uFF0C\u6587\u4EF6\u4E00\u4E2A\u90FD\u6CA1\u52A8"
    },
    error: {
      loadFailed: "\u52A0\u8F7D\u5931\u8D25\uFF1A{{message}}",
      ipcDenied: "\u8BE5\u64CD\u4F5C\u88AB\u62D2\u7EDD\uFF1A{{message}}",
      bootFailed: "\u542F\u52A8\u5931\u8D25",
      pathProblem: "\u65E0\u6CD5\u8BBF\u95EE\u8BE5\u8DEF\u5F84",
      crashed: "\u754C\u9762\u51FA\u4E86\u70B9\u95EE\u9898\uFF0C\u6587\u4EF6\u6CA1\u88AB\u52A8\u8FC7\u3002\u91CD\u65B0\u52A0\u8F7D\u5C31\u597D\u3002",
      reload: "\u91CD\u65B0\u52A0\u8F7D"
    },
    collections: {
      keywords: "\u5173\u952E\u8BCD",
      keywordsHint: "\u9017\u53F7\u5206\u9694\uFF0C\u4F1A\u505A\u5C0F\u5199\u4E0E\u5047\u540D\u5F52\u4E00\u5316",
      matchMode: "\u5339\u914D\u65B9\u5F0F",
      priority: "\u4F18\u5148\u7EA7",
      autoSwitchNote: "\u68C0\u6D4B\u5230\u67D0\u4E2A Unity \u5DE5\u7A0B\u521A\u6253\u5F00\u65F6\uFF0C\u6309\u8FD9\u91CC\u7684\u89C4\u5219\u5207\u5230\u5BF9\u5E94\u96C6\u5408\u3002\u6539\u5B8C\u7ACB\u523B\u751F\u6548\uFF0C\u4E0D\u7528\u91CD\u542F\u3002",
      addTo: "\u52A0\u5165\u96C6\u5408\u2026",
      added: "{{count}} \u9879\u5DF2\u52A0\u5165\u300C{{name}}\u300D",
      backfillCta: "\u6309\u5E93\u91CC\u51FA\u73B0\u8FC7\u7684\u6A21\u578B\u8865\u5EFA",
      backfillHint: "\u626B\u4E00\u904D\u5E93\u91CC\u6807\u4E86\u6A21\u578B\u7684\u7D20\u6750\uFF0C\u628A\u8FD8\u6CA1\u5EFA\u7684\u96C6\u5408\u4E00\u6B21\u8865\u9F50",
      backfillEmptyHint: "\u8FD8\u6CA1\u6709\u96C6\u5408\u3002\u6253\u5F00 Unity \u65F6\u5B83\u6CA1\u5730\u65B9\u53EF\u5207 \u2014\u2014 \u5148\u6309\u5E93\u91CC\u51FA\u73B0\u8FC7\u7684\u6A21\u578B\u8865\u5EFA\u4E00\u6279\u3002",
      backfillTitle: "\u6309\u5E93\u91CC\u51FA\u73B0\u8FC7\u7684\u6A21\u578B\u8865\u5EFA\u96C6\u5408",
      backfillLoading: "\u6B63\u5728\u6570\u5E93\u91CC\u7684\u6A21\u578B\u2026",
      backfillSummary: "\u5C06\u5EFA {{count}} \u4E2A\u96C6\u5408\uFF0C\u8986\u76D6 {{covered}} \u6761\u7D20\u6750\u3002",
      backfillAllExist: "\u5E93\u91CC\u51FA\u73B0\u8FC7\u7684\u6A21\u578B\u90FD\u5DF2\u7ECF\u5EFA\u8FC7\u4E86\uFF08\u73B0\u6709 {{existing}} \u4E2A\u96C6\u5408\uFF09\u3002",
      backfillEmpty: "\u5E93\u91CC\u8FD8\u6CA1\u6709\u5E26\u6A21\u578B\u4FE1\u606F\u7684\u7D20\u6750\uFF1A\u5148\u5165\u5E93\u6216\u8DD1\u4E00\u6B21\u300C\u91CD\u65B0\u5206\u6790\u300D\uFF0C\u518D\u56DE\u6765\u8865\u5EFA\u3002",
      backfillSkippedGeneric: "\u8DF3\u8FC7\u4E86 {{count}} \u4E2A\u901A\u7528\u503C\uFF08\u5982 UNIVERSAL / \u5171\u901A\uFF09\u2014\u2014 \u5B83\u4EEC\u4E0D\u662F\u6A21\u578B\u540D\uFF0C\u5EFA\u6210\u96C6\u5408\u4F1A\u54AC\u4F4F\u6240\u6709\u5DE5\u7A0B\u3002",
      backfillConfirm: "\u5EFA\u8FD9 {{count}} \u4E2A",
      backfillUndoHint: "\u4E0D\u6EE1\u610F\u53EF\u4EE5\u6309 Ctrl+Z \u6574\u6279\u9000\u56DE\u6765",
      backfillHits: "{{count}} \u6761\u7D20\u6750",
      backfillKeywords: "{{count}} \u4E2A\u5173\u952E\u8BCD",
      backfillDone: "\u8865\u5EFA\u4E86 {{count}} \u4E2A\u96C6\u5408",
      backfillIgnored: "{{count}} \u4E2A\u540D\u5B57\u4E0D\u5728\u521A\u624D\u7684\u9884\u89C8\u91CC\uFF0C\u6CA1\u5EFA"
    },
    ingest: {
      apiNotReady: "\u6444\u53D6\u5F15\u64CE\u8FD8\u6CA1\u8D77\u6765",
      queued: "\u5DF2\u767B\u8BB0\uFF0C\u7B49\u5F85\u6444\u53D6",
      needPassword: "\u8FD9\u4E2A\u538B\u7F29\u5305\u9700\u8981\u5BC6\u7801\uFF1A",
      retry: "\u91CD\u8BD5",
      commit: "\u786E\u8BA4\u5165\u5E93",
      duplicateFound: "\u5E93\u91CC\u5DF2\u7ECF\u6709\u540C\u4E00\u4E2A\u7D20\u6750\uFF1A{{name}}",
      duplicateOpen: "\u6253\u5F00\u5DF2\u6709",
      duplicateImportAnyway: "\u4ECD\u7136\u5BFC\u5165",
      duplicateSkip: "\u8DF3\u8FC7",
      entries: "\u5305\u5185 {{count}} \u4E2A\u6761\u76EE",
      ready: "\u6307\u7EB9\u5B8C\u6210\uFF0C\u786E\u8BA4\u5206\u7C7B\u540E\u5165\u5E93",
      readyWithWarning: "\u6307\u7EB9\u5B8C\u6210\uFF08\u6709\u63D0\u793A\uFF0C\u89C1\u4E0B\uFF09",
      committed: "\u5DF2\u5165\u5E93",
      requeued: "\u5E26\u5BC6\u7801\u91CD\u65B0\u5904\u7406",
      failed: "\u6444\u53D6\u4EFB\u52A1\u5F02\u5E38",
      msg: {
        hashingTree: "\u6B63\u5728\u8BA1\u7B97\u76EE\u5F55\u6307\u7EB9",
        listingTree: "\u6B63\u5728\u5217\u51FA\u76EE\u5F55",
        hashing: "\u6B63\u5728\u8BA1\u7B97\u6307\u7EB9",
        probing: "\u6B63\u5728\u8BC6\u522B\u771F\u5B9E\u683C\u5F0F",
        listingEntries: "\u6B63\u5728\u8BFB\u53D6\u5305\u5185\u6E05\u5355",
        extracting: "\u6B63\u5728\u89E3\u538B",
        extractingFile: "\u6B63\u5728\u89E3\u538B\uFF1A{{file}}",
        diggingPackage: "\u6B63\u5728\u8BFB\u53D6\u5185\u5C42 unitypackage"
      },
      warn: {
        extMismatch: "\u6269\u5C55\u540D\u4E0E\u771F\u5B9E\u5185\u5BB9\u4E0D\u7B26\uFF1A{{name}} \u5B9E\u9645\u662F {{label}}",
        splitVolume: "\u8FD9\u662F\u5206\u5377\u538B\u7F29\u5305\uFF0C\u9700\u8981\u540C\u7EC4\u5176\u5B83\u5377\u653E\u5728\u65C1\u8FB9",
        notExtracted: "\u672A\u89E3\u538B\uFF08\u8BBE\u7F6E\u91CC\u201C\u81EA\u52A8\u89E3\u538B\u201D\u5173\u7740\uFF09\uFF1A\u53EA\u767B\u8BB0\u539F\u4EF6\u4E0E\u5305\u5185\u6E05\u5355",
        dugUnitypackages: "\u5DF2\u89E3\u6790 {{count}} \u4E2A\u5185\u5C42 unitypackage\uFF0C\u8BFB\u51FA {{files}} \u6761\u5DE5\u7A0B\u8DEF\u5F84"
      },
      corruptArchive: "\u8FD9\u4E2A\u5305\u635F\u574F\u4E86\u6216\u683C\u5F0F\u4E0D\u652F\u6301\uFF0C\u8BFB\u4E0D\u51FA\u5185\u5BB9",
      workerCrash: "\u5904\u7406\u8FD9\u4E2A\u6587\u4EF6\u7684\u540E\u53F0\u7EBF\u7A0B\u5D29\u4E86\uFF0C\u65E5\u5FD7\u91CC\u6709\u6808",
      passwordNeeded: "\u8FD9\u4E2A\u5305\u6709\u5BC6\u7801\uFF0C\u5148\u8F93\u5165\u5BC6\u7801",
      autoArchiveFailed: "\u81EA\u52A8\u5F52\u6863\u5931\u8D25\uFF0C\u6539\u6210\u4EBA\u5DE5\u786E\u8BA4",
      commitOneFailed: "\u8FD9\u4E00\u9879\u6CA1\u80FD\u5165\u5E93",
      reopened: "\u5DF2\u64A4\u9500\uFF0C\u56DE\u5230\u5F85\u786E\u8BA4",
      rememberPassword: "\u8BB0\u4F4F\u8FD9\u4E2A\u5BC6\u7801",
      rememberPasswordHint: "\u53EA\u5B58\u5728\u8FD9\u53F0\u673A\u5668\u4E0A\uFF0C\u7528\u4F60\u7684 Windows \u8D26\u6237\u52A0\u5BC6",
      vaultStored: "\u5DF2\u8BB0\u4F4F\u8FD9\u4E2A\u5305\u7684\u5BC6\u7801",
      vaultUnavailable: "\u8FD9\u53F0\u673A\u5668\u4E0A\u5B58\u4E0D\u4E86\u5BC6\u7801\uFF08\u7CFB\u7EDF\u52A0\u5BC6\u4E0D\u53EF\u7528\uFF09\u2014\u2014 \u5BC6\u7801\u6CA1\u6709\u88AB\u660E\u6587\u4FDD\u5B58",
      vaultFailed: "\u6CA1\u80FD\u5B58\u4E0B\u5BC6\u7801\uFF08\u7CFB\u7EDF\u52A0\u5BC6\u62A5\u9519\uFF09\u2014\u2014 \u5BC6\u7801\u6CA1\u6709\u88AB\u660E\u6587\u4FDD\u5B58"
    },
    undo: {
      unsupported: "\u8FD9\u7C7B\u64CD\u4F5C\u4E0D\u652F\u6301\u64A4\u9500"
    },
    err: {
      emptyPath: "\u7A7A\u8DEF\u5F84",
      notAbsolute: "\u4E0D\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF1A{{path}}",
      forbiddenTarget: "\u7CFB\u7EDF\u76EE\u5F55\u4E0D\u5141\u8BB8\u6444\u53D6\uFF1A{{path}}",
      selfIngest: "\u8FD9\u662F Atrium \u81EA\u5DF1\u7684\u76EE\u5F55\uFF0C\u4E0D\u80FD\u81EA\u6444\uFF1A{{path}}",
      alreadyInLibrary: "\u5DF2\u5728\u5E93\u5185\uFF0C\u65E0\u9700\u91CD\u590D\u6444\u53D6\uFF1A{{path}}",
      notStringPath: "\u4E0D\u662F\u6709\u6548\u7684\u5B57\u7B26\u4E32\u8DEF\u5F84",
      statFailed: "\u8BFB\u4E0D\u5230\u8FD9\u4E2A\u6587\u4EF6\uFF1A{{path}}",
      pathOutside: "\u8DEF\u5F84\u8D8A\u754C\uFF1A{{target}} \u4E0D\u5728 {{root}} \u5185",
      splitContinuation: "\u8FD9\u662F\u5206\u5377\u7684\u540E\u7EED\u5377\uFF0C\u5DF2\u6539\u4E3A\u5904\u7406\u300C{{path}}\u300D",
      containsRegistered: "\u8FD9\u4E2A\u76EE\u5F55\u91CC\u5DF2\u7ECF\u6709 {{count}} \u6761\u767B\u8BB0\u8FC7\u7684\u7D20\u6750\uFF0C\u6574\u541E\u4F1A\u628A\u5B83\u4EEC\u4E00\u8D77\u642C\u8D70",
      extractNoLibrary: "\u8FD8\u6CA1\u6709\u8BBE\u7F6E\u7D20\u6750\u5E93\uFF0C\u5B83\u63A8\u4E0D\u51FA\u5B89\u5168\u7684\u62BD\u53D6\u76EE\u5F55\u3002\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u5E93 \u6307\u4E00\u6B21\u5E93\u6839\uFF0C\u6216\u76F4\u63A5\u5728\u300C\u62BD\u53D6\u76EE\u5F55\u300D\u91CC\u586B\u4E00\u4E2A\u3002",
      extractNoRoot: "\u62BD\u53D6\u76EE\u5F55\u4E3A\u7A7A\u6216\u63A8\u5BFC\u5931\u8D25\uFF08\u5E93\u6839\uFF1A{{libraryRoot}}\uFF09\u3002",
      extractInsideLibrary: "\u62BD\u53D6\u76EE\u5F55\u4E0D\u80FD\u4F4D\u4E8E\u7D20\u6750\u5E93\u4E4B\u5185\uFF1A{{extractRoot}} \u5728 {{libraryRoot}} \u91CC\u9762\u3002\u5426\u5219\u4E34\u65F6\u62BD\u51FA\u6765\u7684\u526F\u672C\u4F1A\u88AB\u5F53\u6210\u300C\u6CA1\u767B\u8BB0\u7684\u7D20\u6750\u300D\u62A5\u8FDB\u6E38\u79BB\u5217\u8868\uFF0C\u70B9\u4E00\u6B21\u91CD\u65B0\u767B\u8BB0\u5C31\u628A\u5783\u573E\u704C\u8FDB\u5E93\u3002",
      extractOnSystemDrive: "\u62BD\u53D6\u76EE\u5F55\u4E0D\u80FD\u5728 C \u76D8\uFF08\u7CFB\u7EDF\u76D8\u7A7A\u95F4\u7D27\u5F20\uFF09\uFF1A{{extractRoot}}\u3002\u8BF7\u5230 \u8BBE\u7F6E \u2192 \u5E93 \u6539\u5230\u7D20\u6750\u6240\u5728\u7684\u90A3\u4E2A\u76D8\u3002",
      extractNoSpace: "\u62BD\u53D6\u76EE\u5F55\u6240\u5728\u76D8\u53EA\u5269 {{freeGB}} GB\uFF0C\u8FD9\u6B21\u8981\u7EA6 {{needGB}} GB \u624D\u5B89\u5168\u3002\u5148\u6E05\u4E00\u6E05\uFF0C\u6216\u8005\u6362\u4E2A\u76D8\u3002",
      batchEmpty: "\u6CA1\u52FE\u4E2D\u4EFB\u4F55\u6210\u5458",
      batchTooBig: "\u4E00\u6B21\u6700\u591A\u5BFC {{max}} \u4E2A\u5305\uFF08\u8FD9\u6B21 {{count}} \u4E2A\uFF09\uFF0C\u8981\u5206 \u2308{{count}}/{{max}}\u2309 \u6279\u4E00\u6279\u4E00\u6279\u6765",
      nothingToImport: "\u52FE\u4E2D\u7684\u6210\u5458\u91CC\u6CA1\u6709\u4E00\u4E2A\u80FD\u5BFC\u5165\uFF08{{blocked}} \u4E2A\u88AB\u6321\u4F4F\uFF0C\u539F\u56E0\u89C1\u6E05\u5355\uFF09",
      memberMissing: "\u6E05\u5355\u91CC\u8FD9\u4E00\u6761\u5728\u5BB9\u5668\u91CC\u5DF2\u7ECF\u627E\u4E0D\u5230\u4E86\uFF0C\u53EF\u80FD\u8FD9\u4E2A\u7D20\u6750\u521A\u88AB\u91CD\u65B0\u6444\u53D6\u8FC7",
      needPassword: "\u8FD9\u4E2A\u538B\u7F29\u5305\u8981\u5BC6\u7801",
      corrupt: "\u538B\u7F29\u5305\u8BFB\u4E0D\u52A8\uFF1A{{detail}}",
      noBackend: "\u8FD9\u53F0\u673A\u5668\u4E0A\u6CA1\u6709\u80FD\u8BFB\u8FD9\u79CD\u683C\u5F0F\u7684\u540E\u7AEF\uFF08RAR \u9700\u8981 7z.exe + 7z.dll\uFF09",
      notAnArchive: "\u5B83\u5176\u5B9E\u4E0D\u662F\u538B\u7F29\u5305\uFF08{{detail}}\uFF09\uFF0C\u8D70\u6587\u4EF6\u5939\u90A3\u6761\u8DEF",
      volumeMissing: "\u8FD9\u662F\u5206\u5377\u538B\u7F29\u5305\uFF0C\u7F3A\u540C\u7EC4\u7684\u5176\u4ED6\u5377\uFF1A{{detail}}",
      extractFailed: "\u62BD\u53D6\u5931\u8D25\uFF1A{{detail}}",
      importCancelled: "\u5DF2\u8BF7\u6C42\u53D6\u6D88\uFF1A\u5F53\u524D\u8FD9\u4E00\u6761\u4F1A\u8DD1\u5B8C\uFF0C\u540E\u9762\u7684\u4E0D\u518D\u53D1",
      planGone: "\u8FD9\u6279\u5DF2\u7ECF\u8FC7\u671F\u4E86\uFF08\u7A0B\u5E8F\u91CD\u542F\u8FC7\u6216\u88AB\u65B0\u6279\u6B21\u6324\u6389\uFF09\uFF0C\u8981\u91CD\u65B0\u9884\u626B\u63CF\u4E00\u904D",
      packageParse: "\u8FD9\u4E2A .unitypackage \u89E3\u6790\u4E0D\u4E86",
      importChainFailed: "\u5BFC\u5165\u8FD9\u4E00\u6B65\u51FA\u9519\u4E86",
      memberListFailed: "\u8FD9\u4E2A\u5BB9\u5668\u7684\u6E05\u5355\u5217\u4E0D\u51FA\u6765",
      badArgs: "\u53C2\u6570\u4E0D\u5BF9\uFF0C\u8FD9\u6B21\u6CA1\u6267\u884C",
      assetGone: "\u8FD9\u6761\u7D20\u6750\u5DF2\u7ECF\u4E0D\u5728\u4E86\uFF08\u53EF\u80FD\u88AB\u5220\u4E86\u6216\u521A\u88AB\u5408\u5E76\u6389\uFF09",
      badCategory: "\u5206\u7C7B\u8868\u91CC\u6CA1\u6709\u8FD9\u4E2A\u4E00\u7EA7\u5206\u7C7B",
      badSubcategory: "\u8FD9\u4E2A\u4E00\u7EA7\u5206\u7C7B\u4E0B\u6CA1\u6709\u90A3\u4E2A\u4E8C\u7EA7\u5206\u7C7B",
      rearchiveStale: "\u76EE\u6807\u76EE\u5F55\u548C\u521A\u624D\u9884\u89C8\u65F6\u4E0D\u4E00\u6837\u4E86\uFF08\u9884\u89C8\uFF1A{{was}} \u2192 \u73B0\u5728\uFF1A{{now}}\uFF09\uFF0C\u6CA1\u6562\u7167\u65E7\u7684\u642C\u3002\u518D\u70B9\u4E00\u6B21\u4FDD\u5B58\u5C31\u4F1A\u91CD\u65B0\u7B97\u4E00\u904D"
    },
    probe: {
      empty: "\u7A7A\u6587\u4EF6",
      text: "\u6587\u672C",
      textUtf8: "UTF-8 \u6587\u672C",
      textUtf16: "UTF-16 \u6587\u672C",
      unknown: "\u672A\u77E5\u683C\u5F0F",
      folder: "\u6587\u4EF6\u5939",
      exe: "\u53EF\u6267\u884C\u6587\u4EF6",
      lnk: "\u5FEB\u6377\u65B9\u5F0F",
      ole: "OLE \u590D\u5408\u6587\u6863\uFF08doc/xls/ppt\uFF09",
      blender: "Blender \u5DE5\u7A0B",
      unityYaml: "Unity \u5E8F\u5217\u5316\u8D44\u6E90"
    },
    classify: {
      reason: {
        hardRule: "{{rule}}",
        matched: "\u547D\u4E2D\u300C{{words}}\u300D\u2192 {{cat}}/{{sub}}",
        usedLearning: "\u7528\u4E86\u4F60\u4EE5\u524D\u4FEE\u6B63\u8FC7\u7684\u89C4\u5219",
        ambiguous: "\u540C\u65F6\u5339\u914D {{a}} \u548C {{b}}\uFF0C\u5224\u4E3A\u6B67\u4E49",
        noSignal: "\u300C{{name}}\u300D\u6CA1\u6709\u4EFB\u4F55\u53EF\u9760\u7EBF\u7D22",
        bundleItems: "\u5408\u96C6\u91CC {{count}} \u4EF6\u5B50\u9879",
        bundleItemsShort: "{{count}} \u4E2A\u5B50\u9879"
      },
      whyBundleName: "\u540D\u5B57\u91CC\u5199\u7740\u300C\u5408\u96C6 / \u30BB\u30C3\u30C8 / pack\u300D\u8FD9\u7C7B\u8BCD",
      whyBundleContainer: "\u76EE\u5F55\u540D\u662F\u4E2A\u5BB9\u5668\u540D\uFF08\u8BA1\u6570\u6216\u5F52\u7C7B\u7528\u7684\u8BCD\uFF09\uFF0C\u4E0D\u50CF\u5546\u54C1\u540D",
      whyBundleCount: "\u4E0B\u9762\u6709 {{count}} \u4E2A\u80FD\u72EC\u7ACB\u5206\u7C7B\u7684\u5B50\u9879"
    },
    health: {
      intro: "\u626B\u63CF\u53EA\u8BFB\uFF0C\u4E0D\u52A8\u6587\u4EF6\u4E5F\u4E0D\u52A8\u5E93\u3002\u6BCF\u4E00\u9879\u8981\u70B9\u5BF9\u5E94\u7684\u6309\u94AE\u624D\u4F1A\u771F\u7684\u505A\u4E8B\u3002",
      scan: "\u626B\u63CF\u5E93",
      scanning: "\u626B\u63CF\u4E2D\u2026",
      scannedAt: "\u626B\u63CF\u4E8E {{time}}",
      truncated: "\u6761\u76EE\u592A\u591A\uFF0C\u626B\u63CF\u5728\u4E2D\u9014\u622A\u65AD\u4E86\uFF0C\u7ED3\u679C\u53EA\u662F\u524D\u4E00\u90E8\u5206\u3002",
      summary: "{{assets}} \u6761\u7D20\u6750 \xB7 {{groups}} \u4E2A\u5206\u7EC4 \xB7 {{bytes}}",
      clean: "\u8FD9\u4E00\u9879\u6CA1\u95EE\u9898",
      missing: "\u50F5\u5C38\u6761\u76EE",
      missingHint: "\u5E93\u91CC\u6709\u8BB0\u5F55\uFF0C\u78C1\u76D8\u4E0A\u5374\u627E\u4E0D\u5230\u6587\u4EF6\uFF08\u591A\u534A\u662F\u62D4\u4E86\u79FB\u52A8\u786C\u76D8\u6216\u5728\u5916\u9762\u5220\u4E86\uFF09\u3002\u53EA\u6807\u8BB0\uFF0C\u4E0D\u5220\u9664\u3002",
      markMissing: "\u6807\u8BB0\u4E3A\u7F3A\u5931",
      unmarkMissing: "\u89E3\u9664\u6807\u8BB0",
      marked: "\u6807\u8BB0\u4E86 {{count}} \u6761",
      restored: "\u89E3\u9664\u4E86 {{count}} \u6761",
      duplicates: "\u5B8C\u5168\u91CD\u590D",
      duplicatesHint: "\u5185\u5BB9\u6307\u7EB9\uFF08xxh64\uFF09\u4E00\u6A21\u4E00\u6837\u3002\u5220\u54EA\u4E00\u4EFD\u7531\u4F60\u51B3\u5B9A\uFF0C\u8FD9\u91CC\u53EA\u5217\u51FA\u6765\u3002",
      reclaim: "\u7559\u4E00\u4EFD\u53EF\u7701 {{bytes}}",
      similar: "\u5C01\u9762\u76F8\u4F3C",
      similarHint: "\u4E24\u5F20\u5C01\u9762\u957F\u5F97\u51E0\u4E4E\u4E00\u6837\uFF08\u540C\u4E00\u5F20\u56FE\u538B\u4E86\u4E24\u6B21\u3001\u6216\u8005\u6362\u4E86\u540D\u5B57\uFF09\u3002\u76F8\u4F3C\u5EA6 0 \u5C31\u662F\u5B8C\u5168\u4E00\u81F4\u3002",
      distance: "\u5DEE\u5F02 {{n}} \u4F4D",
      strays: "\u6E38\u79BB\u6587\u4EF6",
      straysHint: "\u5728\u5E93\u76EE\u5F55\u91CC\u3001\u4F46\u5E93\u91CC\u6CA1\u6709\u767B\u8BB0\u3002\u53EF\u4EE5\u539F\u6837\u4E22\u8FDB\u53D6\u7269\u961F\u5217\u91CD\u65B0\u8BA4\u4E00\u904D\u3002",
      reindexStrays: "\u91CD\u65B0\u767B\u8BB0",
      largest: "\u5360\u7A7A\u95F4\u6392\u884C",
      largestHint: "\u6700\u5927\u7684\u90A3\u4E9B\u7D20\u6750\uFF0C\u5148\u62FF\u5B83\u4EEC\u5F00\u5200\u6700\u5212\u7B97\u3002",
      orphans: "\u5B64\u513F\u53D8\u4F53",
      orphansHint: "\u5206\u7EC4\u91CC\u53EA\u5269\u4E00\u4EFD\uFF08\u6216\u8005\u4E00\u4EFD\u90FD\u4E0D\u5269\uFF09\u2014\u2014 \u5F52\u5E76\u505A\u8FC7\u5934\u4E86\uFF0C\u89E3\u6563\u6389\u624D\u7B97\u5E72\u51C0\u3002",
      dissolve: "\u89E3\u6563\u8FD9\u4E9B\u5206\u7EC4",
      dissolved: "\u89E3\u6563\u4E86 {{count}} \u4E2A\u5206\u7EC4\uFF0C{{freed}} \u6761\u7D20\u6750\u56DE\u5230\u72EC\u7ACB\u72B6\u6001",
      thumbs: "\u7F29\u7565\u56FE\u7F13\u5B58",
      thumbsHint: "\u6E05\u6389\u6CA1\u6709\u7D20\u6750\u5F15\u7528\u7684\u7F13\u5B58\u56FE\uFF08\u64A4\u9500\u3001\u5220\u9664\u4E4B\u540E\u7559\u4E0B\u7684\uFF09\u3002",
      pruneThumbs: "\u6E05\u7406\u7F13\u5B58",
      pruned: "\u5220\u4E86 {{removed}} \u5F20\uFF0C\u7559\u4E86 {{kept}} \u5F20",
      rebuilt: "\u8865\u56DE {{count}} \u6761\u8BB0\u5F55\uFF0C\u68C0\u7D22\u7D22\u5F15 {{docs}} \u6761",
      openFile: "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u663E\u793A",
      queued: "\u5DF2\u4E22\u8FDB\u53D6\u7269\u961F\u5217\uFF1A{{count}} \u9879",
      noLibrary: "\u8FD8\u6CA1\u8BBE\u7F6E\u5E93\u6839\u76EE\u5F55\uFF08\u8BBE\u7F6E \u2192 \u5E93\uFF09\uFF0C\u6E38\u79BB\u6587\u4EF6\u8FD9\u9879\u626B\u4E0D\u4E86\u3002",
      reclaimNone: "\u4E00\u6761\u90FD\u6CA1\u8FDB\u53BB\uFF1A{{count}} \u9879\u5168\u88AB\u6321\u4E0B\uFF08\u591A\u534A\u662F\u8FD9\u91CC\u5DF2\u7ECF\u767B\u8BB0\u8FC7\uFF0C\u6216\u8005\u76EE\u5F55\u91CC\u542B\u5DF2\u767B\u8BB0\u7D20\u6750\uFF09",
      reclaimPartial: "{{ok}} \u9879\u5DF2\u6392\u961F\uFF0C{{no}} \u9879\u88AB\u6321\u4E0B",
      scope: "\u626B\u63CF\u8303\u56F4",
      scopePick: "\u53EA\u626B\u67D0\u4E2A\u5B50\u76EE\u5F55\u2026",
      scopeWhole: "\u6539\u56DE\u626B\u6574\u4E2A\u5E93",
      reindexSelected: "\u767B\u8BB0\u52FE\u9009\u7684 {{count}} \u9879",
      selectAll: "\u5168\u9009",
      clearAll: "\u53D6\u6D88\u5168\u9009",
      autoArchiveNudge: "\u5206\u6279\u6536\u7F16\u5EFA\u8BAE\u5148\u5728 \u8BBE\u7F6E \u2192 \u5E93 \u91CC\u5173\u6389\u300C\u9AD8\u7F6E\u4FE1\u5EA6\u81EA\u52A8\u5F52\u6863\u300D\uFF0C\u8FD9\u6837\u767B\u8BB0\u540E\u5168\u90E8\u8FDB\u5F85\u786E\u8BA4\uFF0C\u4F60\u70B9\u786E\u8BA4\u624D\u642C\u6587\u4EF6\u3002",
      hasExtracted: "\u65C1\u8FB9\u8FD8\u6709 {{n}} \u4E2A\u540C\u540D\u5DF2\u89E3\u538B\u76EE\u5F55\uFF08\u767B\u8BB0\u53EA\u8FDB\u8FD9\u4E2A\u5305\uFF0C\u526F\u672C\u7559\u5728\u539F\u5730\uFF09",
      trashSelected: "\u9001\u56DE\u6536\u7AD9\uFF08{{count}}\uFF09",
      trashConfirm: "\u628A\u8FD9 {{count}} \u9879\u9001\u8FDB\u56DE\u6536\u7AD9\uFF1F\u968F\u65F6\u53EF\u4EE5\u4ECE\u56DE\u6536\u7AD9\u8FD8\u539F\uFF0C\u4E5F\u53EF\u4EE5\u5728\u64CD\u4F5C\u65E5\u5FD7\u91CC\u67E5\u5230\u3002",
      trashed: "{{count}} \u9879\u5DF2\u8FDB\u56DE\u6536\u7AD9",
      trashPartial: "{{ok}} \u9879\u8FDB\u4E86\u56DE\u6536\u7AD9\uFF0C{{no}} \u9879\u5931\u8D25"
    },
    rearchive: {
      title: "\u6539\u5206\u7C7B\uFF1A{{from}} \u2192 {{to}}",
      now: "\u73B0\u5728\u5728",
      target: "\u8981\u642C\u5230",
      unknownPath: "\uFF08\u6CA1\u8BA4\u51FA\u6765\uFF09",
      size: "{{files}} \u4E2A\u6587\u4EF6 \xB7 {{size}}",
      planning: "\u6B63\u5728\u7B97\u8981\u642C\u4EC0\u4E48\u2026",
      moveIt: "\u642C\u8FC7\u53BB",
      moving: "\u6B63\u5728\u642C\u2026",
      recordOnly: "\u53EA\u6539\u8BB0\u5F55",
      recordOnlyHint: "\u300C\u53EA\u6539\u8BB0\u5F55\u300D= \u5361\u7247\u4E0A\u7684\u5206\u7C7B\u6539\u4E86\uFF0C\u6587\u4EF6\u7559\u5728\u539F\u5730\u4E0D\u52A8\uFF08\u4E5F\u5C31\u662F\u4EE5\u524D\u7684\u884C\u4E3A\uFF09\u3002",
      undoHint: "\u642C\u5B8C\u53EF\u4EE5\u6309 Ctrl+Z \u4E00\u6B21\u64A4\u56DE\uFF1A\u6587\u4EF6\u642C\u56DE\u539F\u4F4D\uFF0C\u5E93\u91CC\u90A3\u4E9B\u8DEF\u5F84\u4E5F\u4E00\u8D77\u6539\u56DE\u6765\u3002",
      movedDone: "\u5DF2\u642C\u597D\uFF1A{{moved}} \u9879\u6587\u4EF6\u3001\u6539\u5199 {{rewrites}} \u6761\u8BB0\u5F55",
      savedOnly: "\u5DF2\u4FDD\u5B58\uFF08\u6587\u4EF6\u6CA1\u52A8\uFF09\uFF1A{{reason}}",
      leftAlone: "\u5DF2\u53EA\u6539\u8BB0\u5F55\uFF0C\u6587\u4EF6\u7559\u5728\u539F\u5730",
      note: {
        taken: "\u8FD9\u4E2A\u4F4D\u7F6E\u5DF2\u7ECF\u6709\u540C\u540D\u7684\u76EE\u5F55\uFF0C\u4F1A\u81EA\u52A8\u6539\u540D\u907F\u5F00\uFF0C\u5B9E\u9645\u642C\u5230\uFF1A{{toDir}}",
        extraMoves: "\u53E6\u6709 {{count}} \u4E2A\u5B50\u9879\u76EE\u5F55\u4E0D\u5728\u7236\u76EE\u5F55\u91CC\u9762\uFF0C\u4F1A\u4E00\u8D77\u642C\u8FDB\u65B0\u7684\u7236\u76EE\u5F55",
        rewrites: "{{count}} \u6761\u9644\u5C5E/\u5B50\u8BB0\u5F55\u7684\u8DEF\u5F84\u4F1A\u8DDF\u7740\u6539\u5199\uFF08\u5B83\u4EEC\u5C31\u5728\u88AB\u642C\u7684\u90A3\u68F5\u76EE\u5F55\u91CC\uFF09"
      },
      reason: {
        noRoot: "\u8FD8\u6CA1\u8BBE\u7F6E\u7D20\u6750\u5E93\uFF0C\u4E0D\u77E5\u9053\u8981\u642C\u5230\u54EA\u513F",
        indexed: "\u8FD9\u4EF6\u662F\u300C\u53EA\u767B\u8BB0\u4E0D\u642C\u300D\uFF0C\u6587\u4EF6\u672C\u6765\u5C31\u4E0D\u5728\u5E93\u91CC",
        missing: "\u539F\u6765\u7684\u76EE\u5F55\u5DF2\u7ECF\u627E\u4E0D\u5230\u4E86\uFF08{{path}}\uFF09",
        outside: "\u5B83\u73B0\u5728\u4E0D\u5728\u7D20\u6750\u5E93\u91CC\u9762\uFF08{{path}}\uFF09\uFF0C\u5B83\u4E0D\u632A\u522B\u4EBA\u76EE\u5F55\u91CC\u7684\u4E1C\u897F",
        samePlace: "\u65B0\u5206\u7C7B\u7B97\u51FA\u6765\u7684\u76EE\u5F55\u5C31\u662F\u73B0\u5728\u8FD9\u4E2A\u4F4D\u7F6E\uFF0C\u6CA1\u4EC0\u4E48\u8981\u642C\u7684",
        unknown: "\u6CA1\u8BF4\u660E\u539F\u56E0"
      }
    },
    variantKind: {
      avatar: "\u9002\u914D\u6A21\u578B",
      install_method: "\u5B89\u88C5\u65B9\u5F0F",
      version: "\u7248\u672C",
      locale: "\u8BED\u8A00",
      quest: "Quest \u7248",
      other: "\u5176\u4ED6\u5DEE\u5F02"
    },
    installed: {
      title: "\u5728\u54EA\u4E9B\u5DE5\u7A0B\u88C5\u8FC7\uFF08{{count}}\uFF09",
      empty: "Atrium \u7684\u5BFC\u5165\u65E5\u5FD7\u91CC\u6CA1\u6709\u8FD9\u6761\u7D20\u6750\u7684\u8BB0\u5F55",
      current: "\u5F53\u524D\u76EE\u6807",
      timeUnknown: "\u65F6\u95F4\u672A\u77E5",
      ghost: "\u5DE5\u7A0B\u5DF2\u4ECE\u6E05\u5355\u91CC\u6D88\u5931",
      packages: "{{count}} \u4E2A\u5305",
      created: "\u65B0\u5EFA {{count}}",
      overwritten: "\u8986\u76D6 {{count}}",
      rolledBack: "\u9000\u56DE {{count}} \u6B21",
      noteLogOnly: "\u53E3\u5F84\uFF1A\u53EA\u7EDF\u8BA1\u901A\u8FC7 Atrium \u5BFC\u5165\u7684\u90A3\u51E0\u6B21\u3002\u4F60\u81EA\u5DF1\u5728 Unity \u91CC\u624B\u52A8 Import \u8FC7\u7684\uFF0C\u5B83\u67E5\u4E0D\u5230\uFF1B\u5BFC\u5B8C\u4E4B\u540E\u53C8\u5728\u5DE5\u7A0B\u91CC\u624B\u52A8\u5220\u6389\u7684\uFF0C\u8FD9\u91CC\u4ECD\u7136\u7B97\u300C\u88C5\u8FC7\u300D\u3002"
    },
    wizard: {
      title: "\u9996\u6B21\u914D\u7F6E",
      subtitle: "\u5171 4 \u6B65\uFF0C\u5B8C\u6210\u540E\u968F\u65F6\u53EF\u4EE5\u5728\u300C\u8BBE\u7F6E\u300D\u4E2D\u4FEE\u6539",
      skip: "\u7A0D\u540E\u914D\u7F6E",
      back: "\u4E0A\u4E00\u6B65",
      next: "\u4E0B\u4E00\u6B65",
      finish: "\u5F00\u59CB\u4F7F\u7528",
      touchesDisk: "\u4F1A\u52A8\u78C1\u76D8",
      step1: {
        title: "\u2460 \u7D20\u6750\u5E93\u5B58\u54EA\u513F",
        body: "\u9009\u62E9\u4E00\u4E2A\u4E13\u95E8\u4FDD\u5B58\u7D20\u6750\u7684\u6587\u4EF6\u5939\u3002\u4EE5\u540E\u6574\u7406\u597D\u7684\u7D20\u6750\u4F1A\u653E\u5728\u8FD9\u91CC\u3002\u8BF7\u4E0E Unity \u5DE5\u7A0B\u76EE\u5F55\u5206\u5F00\u3002",
        pick: "\u9009\u62E9\u6587\u4EF6\u5939",
        pickTitle: "\u9009\u5E93\u6839\u76EE\u5F55",
        probing: "\u6B63\u5728\u770B\u8FD9\u4E2A\u76EE\u5F55\u2026",
        notFound: "\u8FD9\u4E2A\u76EE\u5F55\u4E0D\u5B58\u5728\uFF08\u521A\u62D4\u4E86\u76D8\uFF1F\uFF09\uFF0C\u6362\u4E2A\u5730\u65B9",
        warnSystemDrive: "\u5B83\u5728 C \u76D8\u3002\u80FD\u7528\uFF0C\u4F46\u7D20\u6750\u5E93\u4F1A\u8D8A\u957F\u8D8A\u5927\uFF0C\u5EFA\u8BAE\u6362\u5230\u522B\u7684\u76D8\u3002",
        warnLowFree: "\u8FD9\u4E2A\u76D8\u5269\u4F59\u7A7A\u95F4\u4E0D\u5230 20 GB\uFF0C\u89E3\u538B\u5927\u538B\u7F29\u5305\u65F6\u53EF\u80FD\u4E0D\u591F\u7528\u3002",
        askTitle: "\u8FD9\u91CC\u5DF2\u7ECF\u6709\u7D20\u6750\u4E86\uFF0C\u8981\u600E\u4E48\u5904\u7F6E\uFF1F",
        adoptTitle: "\u767B\u8BB0\u5DF2\u6709\u7D20\u6750",
        adoptBody: "\u626B\u63CF\u5E76\u767B\u8BB0\u73B0\u6709\u7D20\u6750\uFF0C\u4FDD\u7559\u539F\u6765\u7684\u6587\u4EF6\u4F4D\u7F6E\u548C\u540D\u79F0\uFF0C\u540C\u65F6\u5173\u95ED\u81EA\u52A8\u5165\u5E93\u3002",
        adoptShort: "\u63A5\u7BA1",
        freshTitle: "\u53EA\u4FDD\u5B58\u4EE5\u540E\u6DFB\u52A0\u7684\u7D20\u6750",
        freshBody: "\u73B0\u6709\u6587\u4EF6\u4FDD\u6301\u539F\u6837\u3002\u4EE5\u540E\u6DFB\u52A0\u7684\u7D20\u6750\u4F1A\u6309\u5206\u7C7B\u5B58\u5230\u8FD9\u91CC\uFF1B\u5EFA\u8BAE\u4F7F\u7528\u7A7A\u6587\u4EF6\u5939\u3002",
        freshShort: "\u7A7A\u5E93",
        chooseThis: "\u5C31\u6309\u8FD9\u4E2A\u6765",
        needRoot: "\u5148\u628A\u5E93\u6839\u9009\u597D\uFF08\u8FD9\u4E00\u6B65\u4E0D\u80FD\u8DF3\uFF09",
        facts: {
          dirs: "\u9876\u5C42\u76EE\u5F55 {{n}} \u4E2A",
          files: "\u652F\u6301\u7684\u7D20\u6750\u6587\u4EF6 {{n}} \u4E2A",
          unknown: "\u6709\u4E9B\u5B50\u76EE\u5F55\u8BFB\u4E0D\u5230\uFF0C\u6587\u4EF6\u6570\u6CA1\u6CD5\u786E\u5B9A",
          free: "\u5269\u4F59\u7A7A\u95F4 {{size}}"
        },
        typePath: "\u6216\u8005\u628A\u8DEF\u5F84\u8D34\u5728\u8FD9\u91CC",
        look: "\u770B\u8FD9\u4E2A\u76EE\u5F55",
        unityProject: "\u8FD9\u662F Unity \u5DE5\u7A0B\u76EE\u5F55\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u7D20\u6750\u4FDD\u5B58\u4F4D\u7F6E\u3002\u8BF7\u53E6\u5EFA\u4E00\u4E2A\u6587\u4EF6\u5939\uFF0C\u4F8B\u5982 E:\\wn\\Atrium\u7D20\u6750\u5E93\u3002Unity \u5DE5\u7A0B\u4F1A\u5728\u540E\u9762\u7684\u6B65\u9AA4\u5355\u72EC\u8FDE\u63A5\u3002",
        forbidden: "\u8BF7\u9009\u62E9\u4E13\u95E8\u4FDD\u5B58\u7D20\u6750\u7684\u6587\u4EF6\u5939\uFF0C\u4E0D\u80FD\u4F7F\u7528\u76D8\u7B26\u6839\u76EE\u5F55\u6216\u7CFB\u7EDF\u76EE\u5F55\u3002"
      },
      step2: {
        title: "\u2461 \u7D20\u6750\u4ECE\u54EA\u513F\u6765",
        body: "\u76D1\u89C6\u6587\u4EF6\u5939\uFF1A\u5F80\u91CC\u4E22\u4E1C\u897F\u5B83\u4F1A\u81EA\u52A8\u6392\u961F\u6536\u7F16\u3002\u4E0D\u60F3\u5F00\u4E5F\u6CA1\u5173\u7CFB \u2014\u2014 \u62D6\u653E\u3001\u8D44\u6E90\u7BA1\u7406\u5668\u53F3\u952E\u300C\u53D1\u9001\u5230 Atrium\u300D\u3001\u547D\u4EE4\u884C\u8FD9\u4E09\u6761\u8DEF\u7167\u5E38\u7528\u3002",
        add: "\u6DFB\u52A0\u76D1\u89C6\u6587\u4EF6\u5939",
        empty: "\u4E00\u4E2A\u90FD\u6CA1\u52A0\uFF08\u8FD9\u4E00\u6B65\u53EF\u4EE5\u5148\u8DF3\u8FC7\uFF09",
        remove: "\u79FB\u9664"
      },
      step3: {
        title: "\u2462 Unity \u81EA\u52A8\u8FDE\u63A5\uFF08\u53EF\u8DF3\u8FC7\uFF09",
        body: "\u6253\u5F00 Unity 2022.3 \u5DE5\u7A0B\u540E\uFF0CAtrium \u4F1A\u81EA\u52A8\u51C6\u5907\u8FDE\u63A5\uFF1B\u9996\u6B21\u7F3A\u5C11\u8FDE\u63A5\u63D2\u4EF6\u65F6\u4F1A\u81EA\u52A8\u5B89\u88C5\u3002",
        none: "\u5C1A\u672A\u53D1\u73B0\u8FD0\u884C\u4E2D\u7684 Unity \u5DE5\u7A0B\u3002\u6253\u5F00\u5DE5\u7A0B\u540E\u4F1A\u81EA\u52A8\u8FDE\u63A5\uFF0C\u4E5F\u53EF\u4EE5\u5148\u7EE7\u7EED\u3002",
        installed: "\u5DF2\u88C5",
        run: "\u8FDE\u63A5\u52FE\u9009\u7684\u5DE5\u7A0B",
        onlyPackages: "\u53EA\u5199 Packages/com.avca.bridge\uFF0C\u4E0D\u52A8 Assets/",
        resultOk: "\u88C5\u4E86 {{copied}} \u4E2A\u6587\u4EF6 \u2192 {{target}}",
        resultBad: "\u6CA1\u88C5\u4E0A\uFF1A{{error}}",
        unknownError: "\u4E3B\u8FDB\u7A0B\u6CA1\u7ED9\u539F\u56E0",
        automatic: "\u81EA\u52A8\u8FDE\u63A5\uFF0C\u65E0\u9700\u9010\u4E2A\u9009\u62E9\u5B89\u88C5\u3002\u6253\u5F00\u5DE5\u7A0B\u672C\u8EAB\u4E0D\u4F1A\u5BFC\u5165\u7D20\u6750\u3002"
      },
      step4: {
        title: "\u2463 \u6536\u5C3E",
        body: "Atrium \u5F97\u5728\u6258\u76D8\u91CC\u6D3B\u7740\uFF0C\u624D\u80FD\u5728 Unity \u4E00\u542F\u52A8\u5C31\u81EA\u52A8\u5207\u5230\u5BF9\u5E94\u96C6\u5408\u3002\u8981\u4E0D\u8981\u5F00\u673A\u81EA\u542F\uFF1F",
        launchYes: "\u5F00\u673A\u81EA\u542F",
        launchNo: "\u4E0D\u7528\uFF0C\u6211\u624B\u52A8\u5F00",
        launchHint: "\u8FD9\u4E00\u9879\u4EE5\u540E\u5728\u300C\u8BBE\u7F6E \u2192 \u5E38\u89C4\u300D\u968F\u65F6\u80FD\u6539\u3002\u4E0D\u52FE\u4E5F\u80FD\u7528\uFF0C\u53EA\u662F\u6BCF\u6B21\u5F97\u5148\u628A Atrium \u6253\u5F00\u3002",
        summary: "\u8D70\u4E4B\u524D\u786E\u8BA4\u4E00\u4E0B"
      },
      summary: {
        libraryRoot: "\u7D20\u6750\u4FDD\u5B58\u6587\u4EF6\u5939",
        mode: "\u5904\u7406\u65B9\u5F0F",
        watched: "\u76D1\u89C6\u6587\u4EF6\u5939",
        bridges: "\u5DF2\u8FDE\u63A5\u7684 Unity \u5DE5\u7A0B",
        autoLaunch: "\u5F00\u673A\u81EA\u542F",
        hotkey: "\u5168\u5C40\u70ED\u952E"
      }
    },
    remerge: {
      autoDone: "\u5E2E\u4F60\u628A {{moved}} \u5F20\u5176\u5B9E\u662F\u540C\u4E00\u4EF6\u4E1C\u897F\u7684\u5361\u5E76\u5230\u4E86\u4E00\u8D77\uFF08{{clusters}} \u5904\uFF09",
      autoDetail: "\u770B\u770B\u6539\u4E86\u4EC0\u4E48",
      autoDetailHide: "\u6536\u8D77",
      autoUndo: "\u64A4\u9500",
      autoOk: "\u77E5\u9053\u4E86",
      autoLineMerged: "{{name}}\uFF1A\u5E76\u8FDB\u6765 {{count}} \u5F20",
      autoLineKeyfix: "{{name}}\uFF1A\u5361\u6CA1\u52A8\uFF0C\u53EA\u662F\u8BA9\u5B83\u4EE5\u540E\u80FD\u81EA\u52A8\u6536\u5230\u4E00\u8D77",
      autoMore: "\u8FD8\u6709 {{count}} \u5904\uFF0C\u5728\u300C\u8BBE\u7F6E \u2192 \u7EF4\u62A4\u300D\u91CC\u80FD\u770B\u5230\u5168\u90E8",
      autoFoot: "\u6587\u4EF6\u3001\u5206\u7C7B\u3001\u5C01\u9762\u90FD\u6CA1\u52A8 \u2014\u2014 \u53EA\u662F\u8FD9\u51E0\u5F20\u5361\u4ECE\u6B64\u7B97\u540C\u4E00\u4EF6\u4E1C\u897F\u3002"
    },
    importHistory: {
      title: "\u5BFC\u5165\u5386\u53F2",
      projectFilter: "\u7B5B\u9009\u5DE5\u7A0B",
      allProjects: "\u5168\u90E8\u5DE5\u7A0B",
      hint: "\u6309\u6279\u6B21\u67E5\u770B\u4EE5\u524D\u5BFC\u5165\u7684\u5305\u3002\u64A4\u56DE\u9700\u8981\u6253\u5F00\u5BF9\u5E94\u7684 Unity \u5DE5\u7A0B\u5E76\u8FDE\u63A5\u6865\u63A5\uFF1B\u53EA\u5904\u7406\u8BE5\u6B21\u5BFC\u5165\u8BB0\u5F55\u7684\u8D44\u6E90\u3002",
      loading: "\u6B63\u5728\u8BFB\u53D6\u5BFC\u5165\u5386\u53F2\u2026",
      empty: "\u8FD8\u6CA1\u6709\u5BFC\u5165\u8BB0\u5F55",
      unknownTime: "\u65F6\u95F4\u672A\u8BB0\u5F55",
      packages: "{{count}} \u4E2A\u5305",
      batchCount: "\u5171 {{count}} \u6279",
      details: "\u67E5\u770B\u5305\u548C\u5904\u7406\u7ED3\u679C",
      files: "\u65B0\u589E {{created}} \u4E2A\u8D44\u6E90 \xB7 \u8986\u76D6 {{overwritten}} \u4E2A\u8D44\u6E90",
      rollback: "\u64A4\u56DE\u6B64\u6279",
      confirmRollback: "\u786E\u8BA4\u64A4\u56DE",
      rollingBack: "\u6B63\u5728\u64A4\u56DE\u2026",
      confirm: "\u8981\u4ECE\u300C{{project}}\u300D\u64A4\u56DE\u8FD9\u6279\u6210\u529F\u5BFC\u5165\u7684 {{count}} \u4E2A\u5305\u5417\uFF1F",
      rollbackWarning: "\u65B0\u589E\u8D44\u6E90\u4F1A\u88AB\u5220\u9664\u3002\u8986\u76D6\u6587\u4EF6\u53EA\u6709\u5F53\u65F6\u4FDD\u5B58\u7684\u5907\u4EFD\u4ECD\u5728\u65F6\u624D\u80FD\u8FD8\u539F\uFF1B\u4F60\u540E\u6765\u624B\u52A8\u4FEE\u6539\u7684\u8D44\u6E90\u4E5F\u53EF\u80FD\u53D7\u5F71\u54CD\u3002",
      noBackup: "{{count}} \u4E2A\u8986\u76D6\u8D44\u6E90\u7F3A\u5C11\u5B8C\u6574\u7684\u53EF\u7528\u5907\u4EFD\uFF0C\u90E8\u5206\u6216\u5168\u90E8\u65E0\u6CD5\u6062\u590D\u5BFC\u5165\u524D\u7684\u5185\u5BB9\u3002",
      rollbackDone: "\u5DF2\u64A4\u56DE {{count}} \u4E2A\u5305",
      rollbackStopped: "\u64A4\u56DE\u5DF2\u505C\u6B62\uFF0C\u5DF2\u5904\u7406 {{count}} \u4E2A\u5305",
      incomplete: "{{count}} \u4E2A\u8D44\u6E90\u672A\u80FD\u5220\u9664\u6216\u6062\u590D\uFF0C\u8BF7\u68C0\u67E5\u5DE5\u7A0B",
      rollbackFailed: "\u64A4\u56DE\u5931\u8D25",
      newerOverlap: "\u540E\u6765\u7684\u5BFC\u5165\u4FEE\u6539\u4E86\u540C\u4E00\u8D44\u6E90\u3002\u8BF7\u5148\u5904\u7406\u8F83\u65B0\u7684\u76F8\u5173\u6279\u6B21\uFF1B\u64A4\u56DE\u4E0D\u5B8C\u6574\u65F6\u9700\u8981\u624B\u52A8\u68C0\u67E5\u5DE5\u7A0B\u3002",
      busyProject: "\u8FD9\u4E2A\u5DE5\u7A0B\u6709\u5BFC\u5165\u6216\u64A4\u56DE\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7B49\u7ED3\u675F\u540E\u5237\u65B0\u3002",
      projectGone: "\u5BF9\u5E94\u5DE5\u7A0B\u5DF2\u4E0D\u5728\u5DE5\u7A0B\u5217\u8868\u4E2D\uFF0C\u65E0\u6CD5\u64A4\u56DE\u3002",
      missingRecord: "\u627E\u4E0D\u5230\u8FD9\u6761\u5BFC\u5165\u8BB0\u5F55\u3002",
      previous: "\u4E0A\u4E00\u9875",
      next: "\u4E0B\u4E00\u9875",
      status: {
        queued: "\u7B49\u5F85\u4E2D",
        running: "\u5904\u7406\u4E2D",
        ok: "\u5DF2\u5BFC\u5165",
        failed: "\u5931\u8D25",
        cancelled: "\u5DF2\u53D6\u6D88",
        rolledback: "\u5DF2\u64A4\u56DE",
        rollbackpartial: "\u64A4\u56DE\u4E0D\u5B8C\u6574"
      },
      partialWarning: "\u672A\u80FD\u5B8C\u6574\u64A4\u56DE\uFF0C\u8BF7\u68C0\u67E5\u5DE5\u7A0B\uFF1B\u7F3A\u5931\u6216\u65E0\u6CD5\u6062\u590D\u7684\u5185\u5BB9\u9700\u8981\u624B\u52A8\u5904\u7406\u3002"
    },
    covers: {
      dependencyChecking: "\u6B63\u5728\u68C0\u67E5\u5DF2\u767B\u8BB0\u5DE5\u7A0B\u7684\u7740\u8272\u5668\u4F9D\u8D56\u2026",
      dependencySetupFailed: "\u65E0\u6CD5\u68C0\u67E5\u4F9D\u8D56\u5DE5\u7A0B\u3002\u8BF7\u91CD\u8BD5\u540E\u518D\u542F\u52A8\u7D20\u6750\u5305\u9884\u89C8\u3002",
      retrySetup: "\u91CD\u8BD5\u4F9D\u8D56\u68C0\u67E5",
      refreshDependencies: "\u5237\u65B0\u4F9D\u8D56\u5DE5\u7A0B",
      dependencyMissingOption: "lilToon \u4E0D\u53EF\u7528",
      dependencyUnreadableOption: "\u65E0\u6CD5\u8BFB\u53D6\u5DE5\u7A0B",
      dependencyUnavailable: "\u5DF2\u4FDD\u5B58\u7684\u4F9D\u8D56\u5DE5\u7A0B\u4E0D\u53EF\u7528\u3002\u8BF7\u9009\u62E9\u5176\u4ED6\u5DE5\u7A0B\u3001\u4F7F\u7528\u7D20\u6750\u5305\u81EA\u5E26\u7740\u8272\u5668\uFF0C\u6216\u4FEE\u590D\u5DE5\u7A0B\u540E\u5237\u65B0\u3002",
      dependencyReasonSaved: "\u6CBF\u7528\u8FD9\u4E2A\u5C01\u9762\u5DF2\u4FDD\u5B58\u7684\u7740\u8272\u5668\u4F9D\u8D56\u9009\u62E9\u3002",
      dependencyReasonRemembered: "\u6839\u636E\u4E0A\u6B21\u6210\u529F\u4FDD\u5B58\u7684\u7D20\u6750\u5305\u5C01\u9762\u63A8\u8350\u3002",
      dependencyReasonSingle: "\u8FD9\u662F\u552F\u4E00\u53EF\u7528\u7684 lilToon \u5DE5\u7A0B\uFF0C\u5DF2\u4E3A\u4F60\u63A8\u8350\u3002",
      dependencyReasonNone: "\u672A\u81EA\u52A8\u9009\u62E9\u5DE5\u7A0B\u3002\u53EF\u4F7F\u7528\u7D20\u6750\u5305\u81EA\u5E26\u7740\u8272\u5668\uFF0C\u6216\u81EA\u884C\u9009\u62E9\u5DE5\u7A0B\u3002",
      dependencyOverride: "\u6B63\u5728\u4F7F\u7528\u4F60\u624B\u52A8\u9009\u62E9\u7684\u4F9D\u8D56\u914D\u7F6E\u3002",
      candidateSearch: "\u641C\u7D22\u5019\u9009\u540D\u79F0\u3001\u8DEF\u5F84\u6216\u6765\u6E90\u7D20\u6750\u5305",
      candidateFilter: "\u5019\u9009\u7269\u54C1\u7C7B\u578B",
      kindAll: "\u5168\u90E8\u7269\u54C1",
      kindPrefab: "\u9884\u5236\u4F53",
      kindModel: "\u539F\u59CB\u6A21\u578B",
      candidateNoMatch: "\u6CA1\u6709\u5339\u914D\u7269\u54C1\u3002\u8BF7\u5C1D\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD\u6216\u7269\u54C1\u7C7B\u578B\u3002",
      elapsed: "\u5DF2\u7528\u65F6 {{seconds}} \u79D2",
      retryDiscovery: "\u91CD\u8BD5\u67E5\u627E\u7269\u54C1",
      retryPreview: "\u91CD\u8BD5\u6240\u9009\u9884\u89C8",
      retryCandidate: "\u91CD\u8BD5\u8FD9\u5F20\u56FE\u7247",
      adviceDependency: "\u8BF7\u9009\u62E9\u53EF\u7528\u7684 lilToon \u4F9D\u8D56\u5DE5\u7A0B\uFF0C\u6216\u4F7F\u7528\u7D20\u6750\u5305\u81EA\u5E26\u7740\u8272\u5668\u3002\u4FEE\u590D\u4F9D\u8D56\u540E\u53EF\u5237\u65B0\u5DE5\u7A0B\u5217\u8868\u3002",
      adviceShader: "\u7D20\u6750\u5305\u9884\u89C8\u53EF\u9009\u62E9 lilToon \u4F9D\u8D56\u5DE5\u7A0B\uFF1BUnity \u5DE5\u7A0B\u9884\u89C8\u8BF7\u5148\u5728 Unity \u4E2D\u4FEE\u590D\u6750\u8D28\uFF0C\u518D\u91CD\u8BD5\u3002",
      adviceEditor: "\u8BF7\u9009\u62E9\u5DF2\u5B89\u88C5\u7684 Unity 2022.3 \u7F16\u8F91\u5668\uFF0C\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      adviceStartup: "\u8BF7\u786E\u8BA4\u672C\u673A Unity \u80FD\u6B63\u5E38\u6253\u5F00\uFF0C\u5B8C\u6210\u6FC0\u6D3B\u6216\u542F\u52A8\u63D0\u793A\u540E\u91CD\u8BD5\u3002",
      adviceSource: "\u8BF7\u786E\u8BA4\u6765\u6E90\u7D20\u6750\u5305\u5B58\u5728\u4E14\u53EF\u8BFB\u53D6\uFF0C\u518D\u91CD\u65B0\u67E5\u627E\u7269\u54C1\uFF0C\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      adviceSourceChanged: "\u8BF7\u91CD\u65B0\u67E5\u627E\u7269\u54C1\uFF0C\u4EE5\u8BFB\u53D6\u66F4\u65B0\u540E\u7684\u6765\u6E90\u7D20\u6750\u5305\u3002",
      adviceConflict: "\u8BF7\u5C1D\u8BD5\u5176\u4ED6\u6765\u6E90\u7D20\u6750\u5305\u3001\u9009\u62E9\u672C\u5730\u56FE\u7247\uFF0C\u6216\u4ECE Unity \u5DE5\u7A0B\u9884\u89C8\u8BE5\u7269\u54C1\u3002",
      adviceLimits: "\u8BF7\u9009\u62E9\u66F4\u5C0F\u7684\u7269\u54C1\u6216\u7D20\u6750\u5305\uFF0C\u6216\u4F7F\u7528\u672C\u5730\u56FE\u7247\u3002",
      adviceTarget: "\u8BF7\u9009\u62E9\u5176\u4ED6\u5E26\u6709\u53EF\u89C1\u7F51\u683C\u7684\u7269\u54C1\uFF0C\u6216\u91CD\u65B0\u67E5\u627E\u7269\u54C1\u3002",
      adviceChanged: "\u8BF7\u91CD\u65B0\u6253\u5F00\u5C01\u9762\u7F16\u8F91\u5668\uFF0C\u8BFB\u53D6\u6700\u65B0\u5C01\u9762\u540E\u518D\u91CD\u8BD5\u3002",
      adviceOffline: "\u8BF7\u6253\u5F00\u6240\u9009 Unity \u5DE5\u7A0B\uFF0C\u7B49\u5F85 Atrium \u6865\u63A5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002",
      adviceBusy: "\u8BF7\u7B49\u5F85 Unity \u5B8C\u6210\u5BFC\u5165\u6216\u7F16\u8BD1\uFF0C\u5E76\u9000\u51FA Play \u6A21\u5F0F\u540E\u91CD\u8BD5\u3002",
      adviceRetry: "\u8BF7\u91CD\u8BD5\u9884\u89C8\u3002\u82E5\u4ECD\u5931\u8D25\uFF0C\u53EF\u91CD\u65B0\u67E5\u627E\u7269\u54C1\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      provider: "\u9884\u89C8\u6765\u6E90",
      providerPackage: "\u4ECE\u7D20\u6750\u5305\u9884\u89C8",
      providerProject: "\u4ECE Unity \u5DE5\u7A0B\u9884\u89C8",
      packageHint: "\u76F4\u63A5\u8BFB\u53D6\u7D20\u6750\u5305\u4E2D\u7684\u6A21\u578B\uFF0C\u5728\u72EC\u7ACB\u9884\u89C8\u5DE5\u7A0B\u4E2D\u751F\u6210\u753B\u9762\u3002\u9009\u62E9\u5019\u9009\u540E\u518D\u4FDD\u5B58\u5C01\u9762\u3002",
      packageDependency: "\u7740\u8272\u5668\u4F9D\u8D56\u5DE5\u7A0B\uFF08\u53EF\u9009\uFF09",
      packageNoDependency: "\u4F7F\u7528\u7D20\u6750\u5305\u81EA\u5E26\u7684\u7740\u8272\u5668",
      packageDependencyHint: "\u7F3A\u5C11 lilToon \u65F6\uFF0C\u53EF\u4ECE\u5DF2\u767B\u8BB0\u5DE5\u7A0B\u8BFB\u53D6\u5176\u6E32\u67D3\u8D44\u6E90\u3002",
      packageCheckingEditor: "\u6B63\u5728\u67E5\u627E\u672C\u673A Unity \u7F16\u8F91\u5668\u2026",
      packageEditorReady: "\u4F7F\u7528\u672C\u673A Unity {{version}} \u751F\u6210\u9884\u89C8",
      packageEditorMissing: "\u672A\u627E\u5230\u53EF\u7528\u7684 Unity 2022.3 \u7F16\u8F91\u5668\u3002\u8BF7\u9009\u62E9\u672C\u673A\u5B89\u88C5\u7684 Unity.exe\uFF0C\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      packageChooseEditor: "\u9009\u62E9 Unity.exe",
      packageEditorFile: "Unity \u7F16\u8F91\u5668",
      packageCandidatesHint: "\u70B9\u51FB\u7F29\u7565\u56FE\u9009\u62E9\u7269\u54C1\uFF0C\u8C03\u6574\u89D2\u5EA6\u540E\u786E\u8BA4\u4FDD\u5B58\u3002",
      packageNoCandidates: "\u7D20\u6750\u5305\u4E2D\u6CA1\u6709\u627E\u5230\u53EF\u9884\u89C8\u7684\u6A21\u578B\u6216\u9884\u5236\u4F53\u3002\u53EF\u9009\u62E9\u672C\u5730\u56FE\u7247\uFF0C\u6216\u5207\u6362\u5230 Unity \u5DE5\u7A0B\u9884\u89C8\u3002",
      packageCandidatesLimited: "\u6700\u591A\u663E\u793A 50 \u4E2A\u5019\u9009\u7269\u54C1\u3002\u53EF\u5207\u6362\u5230 Unity \u5DE5\u7A0B\u9884\u89C8\u6765\u641C\u7D22\u5177\u4F53\u7269\u54C1\u3002",
      packageReading: "\u6B63\u5728\u8BFB\u53D6\u7D20\u6750\u5305\u2026",
      packagePreparing: "\u6B63\u5728\u51C6\u5907\u7D20\u6750\u5305\u9884\u89C8\u2026",
      packageStarting: "\u6B63\u5728\u542F\u52A8\u72EC\u7ACB Unity \u9884\u89C8\u5DE5\u7A0B\uFF0C\u9996\u6B21\u542F\u52A8\u53EF\u80FD\u9700\u8981\u4E24\u5206\u949F\u2026",
      packageLoading: "Unity \u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u548C\u6750\u8D28\u2026",
      packageDiscovering: "\u6B63\u5728\u67E5\u627E\u7D20\u6750\u5305\u4E2D\u7684\u5019\u9009\u7269\u54C1\u2026",
      packageRendering: "\u6B63\u5728\u751F\u6210\u5019\u9009\u753B\u9762\u2026",
      packageMissingShader: "\u7D20\u6750\u7F3A\u5C11\u6750\u8D28\u6216\u7740\u8272\u5668\u3002\u82E5\u4F7F\u7528 lilToon\uFF0C\u8BF7\u9009\u62E9\u7740\u8272\u5668\u4F9D\u8D56\u5DE5\u7A0B\u540E\u91CD\u65B0\u67E5\u627E\uFF1B\u4E5F\u53EF\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      packageLimitExceeded: "\u7D20\u6750\u5305\u8D85\u8FC7\u9884\u89C8\u8BFB\u53D6\u9650\u989D\uFF0C\u6216\u8BFB\u53D6\u65F6\u95F4\u8FC7\u957F\u3002\u8BF7\u4F7F\u7528\u66F4\u5C0F\u7684\u7D20\u6750\u5305\uFF0C\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      unityMissing: "\u627E\u4E0D\u5230\u53EF\u7528\u7684 Unity 2022.3\u3002\u8BF7\u9009\u62E9\u5DF2\u5B89\u88C5\u7684 Unity.exe\uFF0C\u6216\u9009\u62E9\u672C\u5730\u56FE\u7247\u3002",
      dependencyMissing: "\u627E\u4E0D\u5230\u6240\u9009\u5DE5\u7A0B\u7684 lilToon \u6E32\u67D3\u8D44\u6E90\u3002\u8BF7\u9009\u62E9\u5305\u542B lilToon \u7684\u5DF2\u767B\u8BB0\u5DE5\u7A0B\uFF0C\u6216\u4F7F\u7528\u7D20\u6750\u5305\u81EA\u5E26\u7684\u7740\u8272\u5668\u3002",
      unityStartFailed: "\u72EC\u7ACB Unity \u9884\u89C8\u5DE5\u7A0B\u542F\u52A8\u5931\u8D25\u3002\u8BF7\u786E\u8BA4\u672C\u673A Unity \u53EF\u4EE5\u6B63\u5E38\u542F\u52A8\uFF0C\u7136\u540E\u91CD\u65B0\u67E5\u627E\u3002\u539F\u5C01\u9762\u5DF2\u4FDD\u7559\u3002",
      unityStartTimeout: "\u542F\u52A8 Unity \u9884\u89C8\u5DE5\u7A0B\u8D85\u65F6\u3002\u8BF7\u68C0\u67E5\u672C\u673A Unity \u662F\u5426\u9700\u8981\u6FC0\u6D3B\u6216\u5904\u7406\u542F\u52A8\u63D0\u793A\uFF0C\u7136\u540E\u91CD\u65B0\u67E5\u627E\u3002",
      unityStopFailed: "\u4E0A\u4E00\u4E2A Unity \u9884\u89C8\u4EFB\u52A1\u672A\u80FD\u6B63\u5E38\u5173\u95ED\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF0C\u6216\u91CD\u542F Atrium\u3002",
      bridgeMissing: "\u9884\u89C8\u7EC4\u4EF6\u6587\u4EF6\u7F3A\u5931\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5 Atrium \u540E\u91CD\u8BD5\u3002",
      previewOwnership: "\u65E0\u6CD5\u8BBF\u95EE\u72EC\u7ACB\u9884\u89C8\u76EE\u5F55\uFF0C\u8BF7\u91CD\u542F Atrium \u540E\u91CD\u65B0\u67E5\u627E\u3002\u539F\u5C01\u9762\u5DF2\u4FDD\u7559\u3002",
      sourceChanged: "\u7D20\u6750\u6E90\u6587\u4EF6\u5728\u9884\u89C8\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u627E\u3002\u539F\u5C01\u9762\u5DF2\u4FDD\u7559\u3002",
      packageConflict: "\u7D20\u6750\u5305\u4E2D\u7684\u8D44\u6E90\u6807\u8BC6\u6216\u8DEF\u5F84\u5B58\u5728\u51B2\u7A81\uFF0C\u65E0\u6CD5\u751F\u6210\u53EF\u9760\u9884\u89C8\u3002\u53EF\u9009\u62E9\u672C\u5730\u56FE\u7247\uFF0C\u6216\u4ECE Unity \u5DE5\u7A0B\u9884\u89C8\u3002",
      packageResourcesExcluded: "\u90E8\u5206\u8D44\u6E90\u4E0D\u7528\u4E8E\u9759\u6001\u6A21\u578B\u9884\u89C8\u3002",
      packageAssetUnsupported: "\u5DF2\u7565\u8FC7\u4E0D\u652F\u6301\u9759\u6001\u9884\u89C8\u7684\u90E8\u5206 .asset \u8D44\u6E90\u3002\u5176\u4F59\u7269\u54C1\u53EF\u7EE7\u7EED\u9884\u89C8\u3002",
      rediscover: "\u91CD\u65B0\u67E5\u627E\u7269\u54C1",
      discovering: "\u6B63\u5728\u4ECE\u8FD9\u4E2A\u7D20\u6750\u7684\u6587\u4EF6\u6E05\u5355\u4E2D\u67E5\u627E\u5DF2\u5BFC\u5165\u7269\u54C1\u2026",
      candidatesHint: "\u81EA\u52A8\u67E5\u627E\u8FD9\u4E2A\u7D20\u6750\u5728\u6240\u9009\u5DE5\u7A0B\u4E2D\u7684\u7269\u54C1\u3002\u70B9\u51FB\u7F29\u7565\u56FE\u9009\u62E9\uFF0C\u518D\u786E\u8BA4\u4FDD\u5B58\u3002",
      candidatesUpgrade: "\u66F4\u65B0\u6865\u63A5\u540E\u53EF\u81EA\u52A8\u67E5\u627E\u7269\u54C1\u3002\u4E5F\u53EF\u4EE5\u5148\u8BFB\u53D6 Unity \u9009\u62E9\u6216\u624B\u52A8\u641C\u7D22\u3002",
      candidateCount: "\u627E\u5230 {{count}} \u4E2A\u7269\u54C1\uFF0C\u8BF7\u9009\u62E9\u8981\u7528\u4F5C\u5C01\u9762\u7684\u753B\u9762",
      candidateAlt: "{{name}} \u7684\u5019\u9009\u5C01\u9762",
      candidateGenerating: "\u6B63\u5728\u751F\u6210\u753B\u9762\u2026",
      candidateProgress: "\u5DF2\u751F\u6210 {{done}} / {{total}} \u4E2A\u5019\u9009\u753B\u9762",
      moreMembers: "\u53E6 {{count}} \u4E2A\u6765\u6E90",
      showMore: "\u663E\u793A\u66F4\u591A\u7269\u54C1",
      cancelFind: "\u53D6\u6D88\u67E5\u627E",
      noCandidates: "\u6CA1\u6709\u627E\u5230\u53EF\u62CD\u6444\u7684\u5DF2\u5BFC\u5165\u7269\u54C1\u3002\u8BF7\u786E\u8BA4\u7D20\u6750\u5DF2\u5BFC\u5165\u6240\u9009\u5DE5\u7A0B\uFF0C\u6216\u5728 Unity \u4E2D\u9009\u4E2D\u5177\u4F53\u7269\u54C1\u540E\u8BFB\u53D6\uFF0C\u4E5F\u53EF\u4EE5\u6309\u540D\u79F0\u641C\u7D22\u3002",
      sourceUnavailable: "\u90E8\u5206\u7D20\u6750\u6587\u4EF6\u65E0\u6CD5\u8BBF\u95EE\uFF0C\u81EA\u52A8\u67E5\u627E\u7ED3\u679C\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002\u53EF\u624B\u52A8\u9009\u62E9 Unity \u7269\u54C1\u3002",
      sourceUnsupported: "\u6B64\u683C\u5F0F\u6682\u4E0D\u652F\u6301\u81EA\u52A8\u67E5\u627E\uFF0C\u53EF\u624B\u52A8\u9009\u62E9 Unity \u7269\u54C1\u3002",
      sourceEncrypted: "\u7D20\u6750\u5305\u5DF2\u52A0\u5BC6\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u7269\u54C1\u6E05\u5355\u3002",
      sourceUnreadable: "\u65E0\u6CD5\u8BFB\u53D6\u5B8C\u6574\u7269\u54C1\u6E05\u5355\uFF0C\u53EF\u624B\u52A8\u641C\u7D22\u6216\u8BFB\u53D6 Unity \u9009\u62E9\u3002",
      inventoryLimited: "\u7D20\u6750\u5305\u8F83\u5927\uFF0C\u4EC5\u67E5\u627E\u4E86\u90E8\u5206\u7269\u54C1\u3002",
      candidatesLimited: "\u5019\u9009\u7ED3\u679C\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002\u53EF\u641C\u7D22\u6216\u8BFB\u53D6 Unity \u9009\u62E9\u6765\u67E5\u627E\u66F4\u591A\u7269\u54C1\u3002",
      chooseObject: "\u9009\u62E9\u8981\u62CD\u6444\u7684\u7269\u54C1",
      errorDetails: "\u67E5\u770B\u9519\u8BEF\u8BE6\u60C5",
      originalPreserveFailed: "\u65E0\u6CD5\u5907\u4EFD\u539F\u59CB\u5C01\u9762\uFF0C\u672C\u6B21\u4FEE\u6539\u672A\u4FDD\u5B58\u3002\u8BF7\u68C0\u67E5\u539F\u56FE\u662F\u5426\u53EF\u8BFB\uFF0C\u4EE5\u53CA\u7F13\u5B58\u76EE\u5F55\u662F\u5426\u6709\u8DB3\u591F\u7A7A\u95F4\u3002",
      edit: "\u7F16\u8F91\u5C01\u9762",
      title: "\u4E3A\u300C{{name}}\u300D\u8BBE\u7F6E\u5C01\u9762",
      intro: "\u4ECE\u7D20\u6750\u5305\u6216 Unity \u5DE5\u7A0B\u751F\u6210\u9759\u6001\u9884\u89C8\uFF0C\u786E\u8BA4\u753B\u9762\u540E\u4FDD\u5B58\u4E3A\u7D20\u6750\u5C01\u9762\u3002",
      project: "Unity \u5DE5\u7A0B",
      chooseProject: "\u9009\u62E9\u5DE5\u7A0B",
      selection: "\u8BFB\u53D6 Unity \u5F53\u524D\u9009\u4E2D\u7269\u54C1",
      search: "\u641C\u7D22\u5DF2\u5BFC\u5165\u7684\u9884\u5236\u4F53\u6216\u6A21\u578B",
      selectionHint: "\u5728 Unity \u5C42\u7EA7\u4E2D\u9009\u4E2D\u5177\u4F53\u7269\u54C1\uFF0C\u4F8B\u5982\u5DE7\u514B\u529B\u76D2\uFF1B\u9009\u62E9\u6574\u4E2A\u89D2\u8272\u4F1A\u628A\u89D2\u8272\u4E00\u8D77\u62CD\u8FDB\u53BB\u3002\u4E5F\u53EF\u4EE5\u641C\u7D22\u5DE5\u7A0B\u91CC\u7684\u9884\u5236\u4F53\u3002",
      object: "\u62CD\u6444\u5BF9\u8C61",
      angle: "\u62CD\u6444\u89D2\u5EA6",
      angleAuto: "\u81EA\u52A8\u53D6\u666F",
      angleScene: "Unity \u5F53\u524D\u89C6\u89D2",
      angleFront: "\u6B63\u9762",
      angleBack: "\u80CC\u9762",
      angleLeft: "\u5DE6\u4FA7",
      angleRight: "\u53F3\u4FA7",
      angleTop: "\u4E0A\u65B9",
      angleBottom: "\u4E0B\u65B9",
      background: "\u80CC\u666F",
      dark: "\u6DF1\u8272",
      light: "\u6D45\u8272",
      generate: "\u751F\u6210\u9884\u89C8",
      generating: "\u6B63\u5728\u7B49\u5F85 Unity \u751F\u6210\u9884\u89C8\u2026",
      previewHint: "\u9884\u89C8\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002\u786E\u8BA4\u89D2\u5EA6\u548C\u5185\u5BB9\u540E\uFF0C\u518D\u70B9\u51FB\u4FDD\u5B58\u5C01\u9762\u3002",
      previewAlt: "{{name}} \u7684\u5C01\u9762\u9884\u89C8",
      save: "\u4FDD\u5B58\u5C01\u9762",
      saved: "\u5C01\u9762\u5DF2\u66F4\u65B0",
      upload: "\u9009\u62E9\u672C\u5730\u56FE\u7247",
      imageFiles: "\u56FE\u7247",
      uploadConfirm: "\u4F7F\u7528\u8FD9\u5F20\u56FE\u7247",
      editorConfirm: "\u4F7F\u7528\u8FD9\u4E2A\u7F16\u8F91\u5668",
      restore: "\u6062\u590D\u539F\u59CB\u5C01\u9762",
      offline: "\u8BF7\u6253\u5F00\u6240\u9009 Unity \u5DE5\u7A0B\uFF0C\u5E76\u786E\u4FDD Atrium \u6865\u63A5\u5DF2\u5B89\u88C5\u3002",
      unityBusy: "Unity \u6B63\u5728\u8FD0\u884C\u3001\u7F16\u8BD1\u6216\u5BFC\u5165\u3002\u8BF7\u9000\u51FA\u8FD0\u884C\u6A21\u5F0F\uFF0C\u7B49\u5F85\u7F16\u8F91\u5668\u7A7A\u95F2\u540E\u91CD\u8BD5\u3002",
      bridgeUpgrade: "\u8BF7\u66F4\u65B0 Unity \u6865\u63A5\uFF0C\u4EE5\u4F7F\u7528\u5F53\u524D\u7248\u672C\u7684\u7269\u54C1\u5C01\u9762\u529F\u80FD\u3002",
      upgrade: "\u66F4\u65B0\u6865\u63A5",
      upgraded: "\u6865\u63A5\u6587\u4EF6\u5DF2\u66F4\u65B0\u3002\u8BF7\u5207\u6362\u5230 Unity\uFF0C\u7B49\u5F85\u7F16\u8BD1\u5B8C\u6210\u540E\u518D\u751F\u6210\u9884\u89C8\u3002",
      bridgeUpgradeFailed: "\u6865\u63A5\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5DE5\u7A0B\u662F\u5426\u53EF\u5199\u6216\u6A21\u677F\u662F\u5426\u5B8C\u6574\u3002",
      noResults: "\u6CA1\u6709\u627E\u5230\u5BF9\u5E94\u7684\u9884\u5236\u4F53\u6216\u6A21\u578B\uFF0C\u8BF7\u6362\u4E2A\u540D\u79F0\u641C\u7D22\u3002",
      noSelection: "Unity \u5C1A\u672A\u9009\u4E2D\u7269\u54C1\uFF0C\u8BF7\u5148\u9009\u4E2D\u540E\u518D\u8BFB\u53D6\u3002",
      temporaryTarget: "\u8BE5\u5BF9\u8C61\u5C1A\u672A\u4FDD\u5B58\u5230\u573A\u666F\u3002\u672C\u6B21\u53EF\u4EE5\u751F\u6210\u5C01\u9762\uFF0C\u4F46\u4FDD\u5B58\u573A\u666F\u5E76\u91CD\u65B0\u5173\u8054\u540E\u624D\u80FD\u6279\u91CF\u66F4\u65B0\u3002",
      batch: "\u66F4\u65B0\u6240\u9009\u5C01\u9762",
      batchTitle: "\u6279\u91CF\u66F4\u65B0\u7269\u54C1\u5C01\u9762",
      batchHint: "\u6309\u5DF2\u4FDD\u5B58\u7684\u7D20\u6750\u5305\u6216\u5DE5\u7A0B\u3001\u7269\u54C1\u548C\u89D2\u5EA6\u9010\u4E2A\u751F\u6210\u3002\u624B\u52A8\u9009\u62E9\u7684\u56FE\u7247\u3001\u672A\u5173\u8054\u7269\u54C1\u6216\u5C1A\u672A\u4FDD\u5B58\u7684\u5BF9\u8C61\u4F1A\u8DF3\u8FC7\u3002\u5931\u8D25\u65F6\u4FDD\u7559\u539F\u5C01\u9762\u3002",
      batchStart: "\u5F00\u59CB\u66F4\u65B0 {{count}} \u9879",
      batchProgress: "\u5DF2\u66F4\u65B0 {{done}} / {{total}} \u9879",
      queued: "\u7B49\u5F85\u4E2D",
      done: "\u5DF2\u66F4\u65B0",
      failed: "\u5931\u8D25\uFF0C\u539F\u5C01\u9762\u4FDD\u7559",
      skipped: "\u5DF2\u8DF3\u8FC7",
      cancelled: "\u5DF2\u53D6\u6D88",
      manualSkipped: "\u4FDD\u7559\u624B\u52A8\u56FE\u7247",
      unlinkedSkipped: "\u8BF7\u5148\u5173\u8054\u5DF2\u4FDD\u5B58\u7684 Unity \u7269\u54C1",
      batchBusy: "\u5DF2\u6709\u5C01\u9762\u66F4\u65B0\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u7B49\u5B83\u5B8C\u6210\u3002",
      targetMissing: "\u627E\u4E0D\u5230\u5BF9\u5E94\u7269\u54C1\uFF0C\u53EF\u80FD\u5DF2\u88AB\u79FB\u52A8\u6216\u5220\u9664\u3002\u8BF7\u91CD\u65B0\u9009\u62E9\u3002",
      noMesh: "\u8BE5\u5BF9\u8C61\u6CA1\u6709\u53EF\u89C1\u6A21\u578B\uFF0C\u8BF7\u9009\u4E2D\u5305\u542B\u6A21\u578B\u7684\u7269\u54C1\u3002",
      missingShader: "\u6750\u8D28\u6216\u7740\u8272\u5668\u7F3A\u5931\uFF0C\u8BF7\u5148\u5728 Unity \u4E2D\u4FEE\u590D\u663E\u793A\u3002",
      invalidBounds: "\u7269\u54C1\u5C3A\u5BF8\u5F02\u5E38\uFF0C\u65E0\u6CD5\u81EA\u52A8\u53D6\u666F\u3002",
      invalidRequest: "\u8BF7\u6C42\u65E0\u6548\uFF0C\u8BF7\u5173\u95ED\u7A97\u53E3\u540E\u91CD\u8BD5\u3002",
      invalidImage: "\u56FE\u7247\u65E0\u6548\u6216\u8FC7\u5927\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u6216\u9009\u62E9\u5C0F\u4E8E 8 MB \u7684\u56FE\u7247\u3002",
      pipelineUnsupported: "\u5F53\u524D\u652F\u6301 Unity Built-in \u6E32\u67D3\u7BA1\u7EBF\uFF0C\u6682\u4E0D\u652F\u6301 URP / HDRP\u3002",
      tooComplex: "\u7269\u54C1\u8FC7\u4E8E\u590D\u6742\uFF0C\u8BF7\u9009\u62E9\u66F4\u5C0F\u7684\u7269\u54C1\u8303\u56F4\u3002",
      renderFailed: "\u9884\u89C8\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 Unity \u63A7\u5236\u53F0\u5E76\u91CD\u8BD5\u3002\u539F\u5C01\u9762\u5DF2\u4FDD\u7559\u3002",
      assetMissing: "\u7D20\u6750\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u3002",
      projectMissing: "\u627E\u4E0D\u5230\u5173\u8054\u5DE5\u7A0B\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9 Unity \u5DE5\u7A0B\u3002",
      previewExpired: "\u9884\u89C8\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u3002",
      changed: "\u751F\u6210\u671F\u95F4\u5C01\u9762\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u5E76\u786E\u8BA4\u3002",
      productSkipped: "\u5DF2\u4FDD\u7559\u5546\u54C1\u56FE\u7247",
      reviewRequired: "\u627E\u5230\u591A\u4E2A\u6216\u9700\u8981\u786E\u8BA4\u7684\u7269\u54C1\uFF0C\u8BF7\u9009\u62E9\u5019\u9009\u56FE\u3002"
    },
    coverTasks: {
      moreResults: "\u663E\u793A\u66F4\u591A\u5904\u7406\u7ED3\u679C",
      reviewListHint: "\u8FD9\u91CC\u53EA\u663E\u793A\u524D 20 \u4EF6\uFF0C\u9009\u56FE\u540E\u4F1A\u81EA\u52A8\u8FDB\u5165\u4E0B\u4E00\u4EF6\uFF0C\u76F4\u5230\u5168\u90E8\u5904\u7406\u5B8C\u6210\u3002",
      updateAll: "\u66F4\u65B0\u5168\u90E8\u5C01\u9762",
      scopes: "\u9009\u62E9\u66F4\u65B0\u8303\u56F4",
      updateFiltered: "\u66F4\u65B0\u5F53\u524D\u7B5B\u9009",
      updateSelected: "\u66F4\u65B0\u6240\u9009\u7D20\u6750\uFF08{{count}}\uFF09",
      title: "\u66F4\u65B0\u7D20\u6750\u5C01\u9762",
      running: "\u6B63\u5728\u66F4\u65B0\u5C01\u9762",
      results: "\u5C01\u9762\u66F4\u65B0\u7ED3\u679C",
      reopen: "\u67E5\u770B\u7ED3\u679C",
      hint: "\u5168\u5E93\u4F9D\u6B21\u66F4\u65B0\uFF0C\u5546\u54C1\u56FE\u548C\u624B\u52A8\u4E0A\u4F20\u56FE\u4F1A\u4FDD\u7559\u3002\u5DF2\u6709\u81EA\u52A8\u5C01\u9762\u91CD\u65B0\u62CD\u6444\uFF1B\u591A\u4E2A\u7269\u54C1\u4EA4\u7ED9\u4F60\u9009\u56FE\u3002\u5173\u95ED\u9762\u677F\u540E\u7EE7\u7EED\u5728\u540E\u53F0\u8FD0\u884C\u3002",
      starting: "\u6B63\u5728\u5EFA\u7ACB\u66F4\u65B0\u4EFB\u52A1\u2026",
      done: "\u5B8C\u6210 {{count}}",
      review: "\u5F85\u9009\u56FE {{count}}",
      failed: "\u5931\u8D25 {{count}}",
      skipped: "\u8DF3\u8FC7 {{count}}",
      current: "\u5F53\u524D\uFF1A{{name}}",
      progress: "\u5C01\u9762\u4EFB\u52A1\u8FDB\u5EA6",
      queued: "\u7B49\u5F85\u5904\u7406\u4E0B\u4E00\u4EF6\u7D20\u6750\u2026",
      hide: "\u6536\u8D77\u9762\u677F",
      stop: "\u505C\u6B62\u66F4\u65B0",
      stopping: "\u6B63\u5728\u505C\u6B62\u2026",
      stopped: "\u66F4\u65B0\u5DF2\u505C\u6B62\uFF0C\u5DF2\u5B8C\u6210\u7684\u5C01\u9762\u4FDD\u7559\u3002",
      retry: "\u4EC5\u91CD\u8BD5\u5931\u8D25\u9879",
      retrying: "\u6B63\u5728\u91CD\u8BD5\u2026",
      undo: "\u64A4\u9500\u672C\u6B21\u66F4\u65B0",
      undoing: "\u6B63\u5728\u64A4\u9500\u2026",
      undoResult: "\u5DF2\u6062\u590D {{restored}} \u9879\uFF1B\u4FDD\u7559 {{preserved}} \u9879\u540E\u7EED\u4FEE\u6539\u3002",
      reviewHeading: "\u5F85\u9009\u56FE",
      chooseHint: "\u5148\u9009\u62E9\u7D20\u6750\uFF0C\u518D\u70B9\u51FB\u5019\u9009\u56FE\u7247\u76F4\u63A5\u8BBE\u4E3A\u5C01\u9762\u5E76\u4FDD\u5B58\u5173\u8054\u3002\u4FDD\u5B58\u540E\u81EA\u52A8\u524D\u5F80\u4E0B\u4E00\u4EF6\u3002",
      loadingChoices: "\u6B63\u5728\u751F\u6210\u672C\u9875\u5019\u9009\u56FE\u2026",
      applying: "\u6B63\u5728\u4FDD\u5B58\u6240\u9009\u56FE\u7247\u2026",
      retryChoices: "\u91CD\u8BD5\u672C\u9875\u56FE\u7247",
      chooseCandidate: "\u5C06 {{name}} \u8BBE\u4E3A\u5C01\u9762",
      candidateAlt: "{{name}} \u7684\u5019\u9009\u5C01\u9762",
      previewFailed: "\u56FE\u7247\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u672C\u9875\u56FE\u7247\u3002",
      noChoices: "\u6CA1\u6709\u53EF\u9009\u62E9\u7684\u5019\u9009\u56FE\uFF0C\u8BF7\u91CD\u8BD5\u6216\u68C0\u67E5\u7D20\u6750\u5305\u3002",
      incomplete: "\u7D20\u6750\u5305\u7684\u5019\u9009\u7ED3\u679C\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u786E\u8BA4\u56FE\u7247\u4E2D\u7684\u7269\u54C1\u540E\u518D\u9009\u62E9\u3002",
      page: "\u7B2C {{page}} / {{pages}} \u9875",
      previous: "\u4E0A\u4E00\u9875",
      next: "\u4E0B\u4E00\u9875",
      errorDetails: "\u663E\u793A\u9519\u8BEF\u8BE6\u60C5",
      requestFailed: "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u6536\u8D77\u9762\u677F\u540E\u91CD\u8BD5\u3002\u73B0\u6709\u5C01\u9762\u4F1A\u4FDD\u7559\u3002",
      refresh: "\u5237\u65B0\u4EFB\u52A1\u72B6\u6001",
      states: {
        queued: "\u6392\u961F\u4E2D",
        running: "\u6B63\u5728\u5904\u7406",
        done: "\u5DF2\u66F4\u65B0",
        review: "\u5F85\u9009\u56FE",
        failed: "\u5931\u8D25\uFF0C\u539F\u56FE\u4FDD\u7559",
        skipped: "\u5DF2\u8DF3\u8FC7",
        cancelled: "\u5DF2\u505C\u6B62",
        restored: "\u5DF2\u6062\u590D"
      }
    },
    vpm: {
      title: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406",
      intro: "\u8FD9\u662F VPM \u9879\u76EE/\u5305\u7BA1\u7406\u7684\u5916\u58F3\uFF0C\u9ED8\u8BA4\u5173\u95ED\u3002\u5B83\u4F1A\u5728\u4F60\u786E\u8BA4\u540E\u6539\u52A8 Unity \u5DE5\u7A0B\u7684 Packages/ \u4E0E vpm-manifest.json\uFF0C\u5E76\u9700\u8981\u653E\u5728\u975E\u7CFB\u7EDF\u76D8\u7684\u6570\u636E\u6839\u3002",
      defaultOff: "\u9ED8\u8BA4\u5173\u95ED\uFF1B\u5F00\u542F\u540E\u4E5F\u53EA\u5728\u4F60\u660E\u786E\u786E\u8BA4\u65F6\u6267\u884C\u5199\u64CD\u4F5C\u3002",
      enable: "\u542F\u7528\u9879\u76EE\u4E0E\u5305\u7BA1\u7406",
      enabling: "\u6B63\u5728\u542F\u7528\u2026",
      disable: "\u505C\u7528",
      disabling: "\u6B63\u5728\u505C\u7528\u2026",
      disableTitle: "\u505C\u7528\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\uFF1F",
      disableBody: "\u53EA\u4F1A\u5173\u95ED\u5F00\u5173\uFF1B\u6570\u636E\u6839\u3001\u542F\u7528\u524D\u5FEB\u7167\u548C\u5DE5\u7A0B\u6587\u4EF6\u90FD\u4F1A\u4FDD\u7559\u3002",
      disableConfirm: "\u505C\u7528",
      dataRoot: "\u6570\u636E\u6839",
      dataRootHint: "\u7F13\u5B58\u3001\u56DE\u6EDA\u4ED3\u548C\u5DE5\u7A0B\u5907\u4EFD\u4F1A\u653E\u5728\u8FD9\u91CC\u3002\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u4E0D\u80FD\u662F\u7CFB\u7EDF\u76D8\u3001\u7D20\u6750\u5E93\u3001Unity \u5DE5\u7A0B\u6216\u5E94\u7528\u5B89\u88C5\u76EE\u5F55\u3002",
      dataRootRequired: "\u5C1A\u672A\u9009\u62E9\u6570\u636E\u6839",
      dataRootUnavailable: "\u8FD9\u4E2A\u6570\u636E\u6839\u5F53\u524D\u4E0D\u53EF\u7528\uFF08\u76EE\u5F55\u4E0D\u5B58\u5728\u3001\u88AB\u79FB\u9664\u6216\u6821\u9A8C\u672A\u901A\u8FC7\uFF09\u3002",
      chooseDataRoot: "\u9009\u62E9\u6587\u4EF6\u5939",
      validationOk: "\u8DEF\u5F84\u68C0\u67E5\u901A\u8FC7\uFF1B\u542F\u7528\u65F6\u8FD8\u4F1A\u9A8C\u8BC1\u5199\u5165\u6743\u9650\u3002",
      stepChoose: "1. \u9009\u62E9\u6570\u636E\u6839",
      stepConfirm: "2. \u786E\u8BA4\u5F71\u54CD",
      risk: "\u6211\u4E86\u89E3\u5B83\u4F1A\u6539\u52A8 Unity \u5DE5\u7A0B\u7684 Packages/ \u4E0E vpm-manifest.json\uFF0C\u4E14\u53EA\u5728\u6211\u786E\u8BA4\u540E\u6267\u884C\u3002",
      enableTitle: "\u542F\u7528\u9879\u76EE\u4E0E\u5305\u7BA1\u7406",
      snapshot: "\u542F\u7528\u524D\u5FEB\u7167",
      noSnapshot: "\u5C1A\u65E0\u5FEB\u7167",
      appVersion: "\u5E94\u7528\u7248\u672C",
      enabled: "\u5DF2\u542F\u7528",
      disabled: "\u5DF2\u5173\u95ED",
      safeMode: "\u5B89\u5168\u6A21\u5F0F",
      safeModeBody: "\u672C\u6B21\u542F\u52A8\u5904\u4E8E\u5B89\u5168\u6A21\u5F0F\uFF1A\u4E0D\u4F1A\u542F\u7528\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\uFF0C\u4E5F\u4E0D\u4F1A\u6267\u884C\u4EFB\u4F55\u5199\u5DE5\u7A0B\u6216\u8054\u7F51\u52A8\u4F5C\u3002",
      degradedBody: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u5904\u4E8E\u964D\u7EA7\u72B6\u6001\uFF1B\u6838\u5FC3\u7D20\u6750\u529F\u80FD\u4E0D\u53D7\u5F71\u54CD\u3002",
      placeholder: "\u5F53\u524D\u7248\u672C\u53EA\u8BFB\u5C55\u793A\u4ED3\u5E93\u4E0E\u5305\u76EE\u5F55\uFF1B\u5B89\u88C5\u3001\u6A21\u677F\u4E0E Unity \u5B89\u88C5\u5C1A\u672A\u63A5\u5165\u3002",
      repos: {
        title: "\u4ED3\u5E93",
        intro: "\u6DFB\u52A0\u4F60\u4FE1\u4EFB\u7684 VPM \u4ED3\u5E93\uFF1B\u5305\u76EE\u5F55\u53EA\u8BFB\uFF0C\u5B89\u88C5\u5C1A\u672A\u63A5\u5165\u3002",
        empty: "\u8FD8\u6CA1\u6709\u4ED3\u5E93\u3002",
        emptyHint: "\u6DFB\u52A0\u4E00\u4E2A HTTPS \u4ED3\u5E93\uFF0C\u6216\u4F7F\u7528 VRChat \u5B98\u65B9/curated \u4ED3\u5E93\uFF08\u9700\u8981\u8054\u7F51\u540C\u610F\uFF09\u3002",
        add: "\u6DFB\u52A0\u4ED3\u5E93",
        addTitle: "\u6DFB\u52A0\u4ED3\u5E93",
        url: "\u5730\u5740",
        urlHint: "\u6539\u5730\u5740\u4F1A\u91CD\u65B0\u6293\u53D6\uFF1B\u65E7\u7D22\u5F15\u4F1A\u4FDD\u7559\u5230\u65B0\u5730\u5740\u6293\u53D6\u6210\u529F\u3002",
        name: "\u540D\u79F0",
        namePlaceholder: "\u7559\u7A7A\u5219\u4F7F\u7528\u57DF\u540D",
        adding: "\u6B63\u5728\u6DFB\u52A0\u2026",
        remove: "\u79FB\u9664",
        removeTitle: "\u79FB\u9664\u4ED3\u5E93\uFF1F",
        removeBody: "\u53EA\u5220\u9664\u672C\u5730\u4ED3\u5E93\u7D22\u5F15\uFF0C\u4E0D\u5220\u9664\u7F13\u5B58\u6216\u4EFB\u4F55\u5DE5\u7A0B\u6587\u4EF6\u3002",
        refresh: "\u5237\u65B0",
        refreshAll: "\u5237\u65B0\u5168\u90E8",
        refreshing: "\u6B63\u5728\u5237\u65B0\u2026",
        never: "\u5C1A\u672A\u6210\u529F\u5237\u65B0",
        lastSuccess: "\u4E0A\u6B21\u6210\u529F\uFF1A{{time}}",
        lastError: "\u4E0A\u6B21\u9519\u8BEF\uFF1A{{error}}",
        network: "\u8054\u7F51",
        packages: "{{count}} \u4E2A\u5305",
        host: "\u6765\u6E90",
        noConsent: "\u8054\u7F51\u5DF2\u5173\u95ED\uFF0C\u5F53\u524D\u53EA\u80FD\u4F7F\u7528\u672C\u5730/\u7F13\u5B58\u6570\u636E\u3002",
        allowNetwork: "\u5F00\u542F\u8054\u7F51",
        networkAllowed: "\u5DF2\u8054\u7F51",
        cacheOnly: "\u4EC5\u7F13\u5B58\u6A21\u5F0F",
        useOfficial: "\u4F7F\u7528\u5B98\u65B9\u4ED3\u5E93",
        officialHint: "\u5B98\u65B9/curated \u4ED3\u5E93\u5DF2\u9ED8\u8BA4\u52A0\u5165\u3002",
        addedOffline: "\u4ED3\u5E93\u5DF2\u6DFB\u52A0\uFF1B\u8054\u7F51\u5173\u95ED\u65F6\u4E0D\u4F1A\u5237\u65B0\u3002",
        edit: "\u7F16\u8F91",
        editTitle: "\u7F16\u8F91\u4ED3\u5E93",
        moveUp: "\u4E0A\u79FB",
        moveDown: "\u4E0B\u79FB",
        headers: "\u8BF7\u6C42\u5934",
        headersTitle: "\u8BF7\u6C42\u5934\uFF08\u6BCF\u4ED3\u5E93\uFF09",
        headersHint: "\u7528\u7CFB\u7EDF\u52A0\u5BC6\u4FDD\u5B58\uFF0C\u503C\u4E0D\u4F1A\u56DE\u663E\u3001\u4E0D\u4F1A\u5199\u65E5\u5FD7\u3002\u53EA\u586B\u8981\u65B0\u589E\u6216\u8986\u76D6\u7684\u5934\uFF1B\u60F3\u6539\u503C\u5C31\u91CD\u65B0\u586B\u4E00\u904D\u3002",
        headersUnavailable: "\u8FD9\u53F0\u673A\u5668\u7684\u7CFB\u7EDF\u52A0\u5BC6\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u8BF7\u6C42\u5934\uFF08\u4E0D\u4F1A\u4EE5\u660E\u6587\u4FDD\u5B58\uFF09\u3002",
        headersPresent: "\u5DF2\u8BBE\u7F6E\uFF1A{{names}}",
        headersAdd: "\u6DFB\u52A0\u4E00\u884C",
        headersClear: "\u6E05\u9664\u5168\u90E8",
        headersSaved: "\u8BF7\u6C42\u5934\u5DF2\u4FDD\u5B58",
        headersCleared: "\u8BF7\u6C42\u5934\u5DF2\u6E05\u9664",
        headersIncomplete: "\u6709\u4E00\u884C\u53EA\u586B\u4E86\u540D\u5B57\u6216\u53EA\u586B\u4E86\u503C",
        test: "\u6D4B\u8BD5\u8FDE\u63A5",
        testOk: "\u8FDE\u63A5\u6B63\u5E38\uFF08HTTP {{status}}\uFF09",
        testFailed: "\u8FDE\u63A5\u5931\u8D25\uFF1A{{error}}",
        import: "\u5BFC\u5165",
        importTitle: "\u5BFC\u5165\u4ED3\u5E93\u5217\u8868",
        importHint: "\u4E00\u884C\u4E00\u4E2A\u4ED3\u5E93\u5730\u5740\uFF08# \u5F00\u5934\u662F\u6CE8\u91CA\uFF09\uFF0C\u6216\u7C98\u8D34\u5BFC\u51FA\u7684 JSON\u3002\u91CD\u590D\u7684\u4F1A\u8DF3\u8FC7\u3002",
        importDone: "\u5DF2\u6DFB\u52A0 {{added}} \u4E2A\uFF0C\u8DF3\u8FC7 {{skipped}} \u4E2A",
        importing: "\u5BFC\u5165\u4E2D\u2026",
        export: "\u5BFC\u51FA",
        exportTitle: "\u5BFC\u51FA\u4ED3\u5E93\u5217\u8868",
        exportHint: '\u590D\u5236\u4E0B\u9762\u7684\u5185\u5BB9\u4FDD\u5B58\u6210\u6587\u4EF6\uFF0C\u6216\u76F4\u63A5\u7C98\u8D34\u5230\u53E6\u4E00\u53F0\u673A\u5668\u7684"\u5BFC\u5165"\u91CC\u3002'
      },
      catalog: {
        title: "\u5305\u76EE\u5F55",
        intro: "\u6D4F\u89C8\u4ED3\u5E93\u91CC\u7684 VPM \u5305\uFF1B\u8FD9\u91CC\u53EA\u80FD\u67E5\u770B\uFF0C\u5B89\u88C5\u5C1A\u672A\u63A5\u5165\u3002",
        browse: "\u6D4F\u89C8\u5305",
        search: "\u641C\u7D22\u5305\u540D\u3001\u663E\u793A\u540D\u3001\u5173\u952E\u8BCD\u6216\u522B\u540D",
        filterAll: "\u5168\u90E8",
        filterInstalled: "\u5DF2\u5B89\u88C5",
        filterUpdatable: "\u53EF\u66F4\u65B0",
        filterUnavailable: "\u5DF2\u5B89\u88C5/\u53EF\u66F4\u65B0\u7B5B\u9009\u4F1A\u5728\u63A5\u5165\u5DE5\u7A0B\u540E\u542F\u7528\u3002",
        empty: "\u8FD8\u6CA1\u6709\u53EF\u6D4F\u89C8\u7684\u5305\u3002\u5148\u6DFB\u52A0\u4ED3\u5E93\u5E76\u5237\u65B0\u3002",
        noResult: "\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u5305\u3002",
        loadMore: "\u52A0\u8F7D\u66F4\u591A",
        latest: "\u6700\u65B0 {{version}}",
        versions: "{{count}} \u4E2A\u7248\u672C",
        unity: "Unity {{version}}",
        sources: "\u6765\u6E90",
        conflict: "\u7248\u672C\u51B2\u7A81",
        conflictBody: "\u540C\u4E00\u7248\u672C\u5728\u4E0D\u540C\u4ED3\u5E93\u91CC hash \u4E0D\u4E00\u81F4\uFF1B\u8FD9\u91CC\u53EA\u5C55\u793A\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u9009\u62E9\u3002",
        select: "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u5305\u67E5\u770B\u8BE6\u60C5\u3002",
        description: "\u63CF\u8FF0",
        noDescription: "\u6CA1\u6709\u63CF\u8FF0\u3002",
        versionList: "\u7248\u672C",
        yanked: "\u5DF2\u5F03\u7528",
        hidden: "\u9690\u85CF",
        deprecated: "\u5DF2\u5F03\u7528",
        changelog: "\u66F4\u65B0\u65E5\u5FD7",
        documentation: "\u6587\u6863",
        installLater: "\u5B89\u88C5\u7559\u5230\u4E0B\u4E00\u9636\u6BB5\uFF1B\u5F53\u524D\u7248\u672C\u53EA\u8BFB\u3002",
        close: "\u5173\u95ED"
      },
      operation: {
        refreshing: "\u6B63\u5728\u5237\u65B0 {{done}}/{{total}}",
        done: "\u5237\u65B0\u5B8C\u6210",
        failed: "\u5237\u65B0\u5931\u8D25"
      },
      external: {
        title: "\u6253\u5F00\u5916\u90E8\u94FE\u63A5\uFF1F",
        body: "\u4F1A\u5728\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00\uFF1A{{url}}",
        open: "\u6253\u5F00",
        cancel: "\u53D6\u6D88"
      },
      projects: {
        title: "\u9879\u76EE\u4E0E\u5305",
        readOnly: "\u53EA\u8BFB",
        intro: "\u8FD9\u91CC\u8BFB\u53D6\u5DE5\u7A0B\u548C\u5DF2\u5B89\u88C5\u5305\uFF1B\u5B89\u88C5\u3001\u5347\u7EA7\u548C\u5378\u8F7D\u7559\u5230\u540E\u7EED\u9636\u6BB5\u3002",
        search: "\u641C\u7D22\u5DE5\u7A0B\u2026",
        add: "\u6DFB\u52A0\u5DF2\u6709\u5DE5\u7A0B",
        addTitle: "\u6DFB\u52A0\u5DF2\u6709\u5DE5\u7A0B",
        addHint: "\u53EA\u8BFB\u53D6\u5DE5\u7A0B\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u6216\u590D\u5236\u6587\u4EF6\u3002",
        path: "\u5DE5\u7A0B\u76EE\u5F55",
        pathPlaceholder: "\u9009\u62E9\u5305\u542B ProjectSettings \u7684 Unity \u5DE5\u7A0B\u76EE\u5F55",
        pick: "\u9009\u62E9\u76EE\u5F55\u2026",
        adding: "\u6B63\u5728\u8BFB\u53D6\u2026",
        empty: "\u8FD8\u6CA1\u6709\u7EB3\u5165\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u5DE5\u7A0B",
        emptyHint: "\u9009\u62E9\u4E00\u4E2A\u5DF2\u6709 Unity \u5DE5\u7A0B\uFF0C\u5148\u5EFA\u7ACB\u53EA\u8BFB\u53F0\u8D26\u3002",
        noMatch: "\u6CA1\u6709\u5339\u914D\u7684\u5DE5\u7A0B",
        refresh: "\u5237\u65B0",
        details: "\u8BE6\u60C5",
        detailTitle: "\u5DE5\u7A0B\u8BE6\u60C5",
        loading: "\u6B63\u5728\u8BFB\u53D6\u5DE5\u7A0B\u2026",
        notLinked: "\u6838\u5FC3\u5217\u8868\u91CC\u5DF2\u7ECF\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u7A0B\uFF1B\u53F0\u8D26\u4ECD\u4FDD\u7559\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5220\u9664\u3002",
        unlinkedShort: "\u53F0\u8D26\u672A\u5173\u8054",
        overview: "\u6982\u89C8",
        unityVersion: "Unity \u7248\u672C",
        revision: "revision",
        editor: "\u7F16\u8F91\u5668",
        notRecorded: "\u672A\u8BB0\u5F55",
        manifest: "vpm-manifest",
        manifestPresent: "\u5DF2\u8BFB\u53D6",
        manifestMissing: "\u6CA1\u6709 vpm-manifest.json",
        manifestHash: "manifest hash",
        lastScan: "\u4E0A\u6B21\u626B\u63CF",
        packages: "\u5DF2\u5B89\u88C5\u5305",
        packageCount: "{{count}} \u4E2A\u5305",
        legacyCount: "{{count}} \u4E2A\u65E7\u5F0F\u5019\u9009",
        noPackages: "\u6CA1\u6709\u8BFB\u53D6\u5230\u5DF2\u5B89\u88C5\u5305\u3002",
        stateLabel: "\u72B6\u6001",
        state: {
          installed: "\u6B63\u5E38",
          missing: "\u7F3A\u5931",
          unlisted: "\u672A\u5217\u51FA",
          mismatch: "\u7248\u672C\u4E0D\u4E00\u81F4",
          protected: "\u53D7\u4FDD\u62A4"
        },
        source: "\u6765\u6E90",
        warnings: "\u8B66\u544A",
        noWarnings: "\u6CA1\u6709\u8B66\u544A\u3002",
        legacy: "\u65E7\u5F0F Assets \u5305",
        legacyHint: "\u53EA\u8BFB\u62A5\u544A\uFF1B\u8FC1\u79FB\u7559\u5230\u540E\u7EED\u9636\u6BB5\uFF0C\u4E0D\u4F1A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002",
        legacyNone: "\u6CA1\u6709\u53D1\u73B0\u65E7\u5F0F\u5305\u5019\u9009\u3002",
        legacyMatch: "\u5339\u914D\u65B9\u5F0F",
        legacyConfidence: "\u7F6E\u4FE1\u5EA6",
        match: {
          packageJson: "package.json",
          legacyFolder: "\u65E7\u76EE\u5F55",
          legacyFile: "\u65E7\u6587\u4EF6",
          legacyPackage: "\u65E7\u5305 ID"
        },
        confidence: {
          high: "\u9AD8",
          medium: "\u4E2D",
          low: "\u4F4E"
        },
        openFolder: "\u6253\u5F00\u6587\u4EF6\u5939",
        rescan: "\u91CD\u65B0\u626B\u63CF",
        remove: "\u4ECE\u53F0\u8D26\u79FB\u9664",
        removeTitle: "\u4ECE\u53F0\u8D26\u79FB\u9664\u5DE5\u7A0B\uFF1F",
        removeBody: "\u53EA\u79FB\u9664 Atrium \u7684\u5DE5\u7A0B\u53F0\u8D26\u8BB0\u5F55\uFF0C\u4E0D\u5220\u9664\u78C1\u76D8\u4E0A\u7684\u5DE5\u7A0B\u6587\u4EF6\u3001\u6838\u5FC3\u5DE5\u7A0B\u6216\u5BFC\u5165\u5386\u53F2\u3002",
        removeDone: "\u5DF2\u4ECE\u53F0\u8D26\u79FB\u9664",
        actionsLater: "\u542F\u52A8 Unity \u548C\u5305\u7BA1\u7406\u7559\u5230\u540E\u7EED\u9636\u6BB5\u3002",
        running: "\u8FD0\u884C\u4E2D",
        notRunning: "\u672A\u8FD0\u884C",
        close: "\u5173\u95ED",
        openUnity: "\u6253\u5F00 Unity",
        launching: "\u6B63\u5728\u542F\u52A8\u2026",
        launched: "\u5DF2\u542F\u52A8\uFF0C\u6B63\u5728\u8FDE\u63A5\u2026",
        alreadyRunning: "Unity \u5DF2\u5728\u8FD0\u884C\uFF0C\u5DF2\u8BBE\u4E3A\u5BFC\u5165\u76EE\u6807",
        editorAuto: "\u81EA\u52A8\uFF08\u6309\u5DE5\u7A0B\u7248\u672C\uFF09",
        launchTimeout: "Unity \u5DF2\u7ECF\u542F\u52A8\uFF0C\u4F46 60 \u79D2\u5185\u6CA1\u8FDE\u4E0A\uFF1A\u591A\u534A\u5361\u5728\u767B\u5F55/\u8BB8\u53EF\u8BC1\u5BF9\u8BDD\u6846\uFF0C\u6216\u8005\u8FD9\u4E2A\u5DE5\u7A0B\u8FD8\u6CA1\u88C5\u6865\u63A5\u3002\u5148\u770B\u4E00\u4E0B Unity \u7A97\u53E3\u3002",
        launchUnverified: "Unity \u6CA1\u6709\u6253\u5F00\u8FD9\u4E2A\u5DE5\u7A0B\uFF0845 \u79D2\u6CA1\u6709\u53CD\u5E94\uFF09\u3002\u5148\u770B\u4E00\u773C\u5C4F\u5E55\u6709\u6CA1\u6709 Unity \u7A97\u53E3\u6216\u767B\u5F55/\u8BB8\u53EF\u8BC1\u5BF9\u8BDD\u6846\uFF1B\u5982\u679C\u6CA1\u6709\uFF0C\u53BB Unity Hub \u91CC\u624B\u52A8\u6253\u5F00\u8FD9\u4E2A\u5DE5\u7A0B\u4E00\u6B21\u3002",
        open: "\u6253\u5F00",
        opened: "\u5DF2\u6253\u5F00",
        manage: "\u7BA1\u7406",
        advanced: "\u9AD8\u7EA7"
      },
      plan: {
        title: "\u53D8\u66F4\u8BA1\u5212\uFF08\u53EA\u8BFB\uFF09",
        preview: "\u67E5\u770B\u53D8\u66F4",
        intro: "\u53EA\u8BA1\u7B97\u4F1A\u53D1\u751F\u4EC0\u4E48\uFF0C\u4E0D\u4E0B\u8F7D\u3001\u4E0D\u5199\u5DE5\u7A0B\u3002\u5E94\u7528\u7559\u5230\u540E\u7EED\u9636\u6BB5\u3002",
        package: "\u5305\u540D",
        range: "\u7248\u672C/\u8303\u56F4",
        previewPackage: "\u9884\u89C8\u5B89\u88C5",
        previewAll: "\u5347\u7EA7\u5168\u90E8\uFF08\u6700\u65B0\uFF09",
        allowPrerelease: "\u5141\u8BB8\u9884\u53D1\u5E03\u7248\u672C",
        loading: "\u6B63\u5728\u89E3\u6790\u2026",
        close: "\u5173\u95ED",
        apply: "\u5E94\u7528\u66F4\u6539",
        applyLater: "\u5E94\u7528\u66F4\u6539\u7559\u5230\u540E\u7EED\u9636\u6BB5",
        blocked: "\u5DF2\u963B\u65AD",
        ready: "\u53EF\u6267\u884C\uFF08\u53EA\u8BFB\u9884\u89C8\uFF09",
        blockedHint: "\u5B58\u5728\u51B2\u7A81\u6216\u7F3A\u5931\uFF0C\u4FEE\u6B63\u540E\u624D\u80FD\u8FDB\u5165\u5B89\u88C5\u4E8B\u52A1\u3002",
        requiresUnityClosed: "\u5E94\u7528\u524D\u9700\u5173\u95ED Unity",
        empty: "\u6CA1\u6709\u9700\u8981\u53D8\u66F4\u7684\u5305\u3002",
        conflicts: "\u51B2\u7A81",
        missing: "\u7F3A\u5931",
        warnings: "\u8B66\u544A",
        downloads: "\u4E0B\u8F7D",
        diskLine: "\u4E0B\u8F7D {{download}} \xB7 \u5B89\u88C5 {{install}}",
        requiredBy: "\u8981\u6C42\u6765\u6E90\uFF1A{{sources}}",
        requested: "\u663E\u5F0F\u8BF7\u6C42",
        major: "\u5927\u7248\u672C",
        rootSource: "\u6839\u4F9D\u8D56",
        action: {
          install: "\u5B89\u88C5",
          upgrade: "\u5347\u7EA7",
          downgrade: "\u964D\u7EA7",
          reinstall: "\u91CD\u88C5",
          remove: "\u79FB\u9664",
          keep: "\u4FDD\u6301"
        },
        reason: {
          root: "\u6839\u4F9D\u8D56",
          dependency: "\u4F20\u9012\u4F9D\u8D56",
          unused: "\u4E0D\u518D\u9700\u8981",
          locked: "\u9501\u5B9A\u7248\u672C",
          reinstall: "\u91CD\u88C5\u8BF7\u6C42"
        },
        conflict: {
          noCandidate: "\u6CA1\u6709\u53EF\u7528\u7248\u672C",
          rangeConflict: "\u7248\u672C\u8303\u56F4\u51B2\u7A81",
          unityIncompatible: "Unity \u7248\u672C\u4E0D\u517C\u5BB9",
          hashConflict: "\u540C\u7248\u672C hash \u51B2\u7A81",
          cycle: "\u4F9D\u8D56\u73AF",
          protectedPackage: "\u53D7\u4FDD\u62A4\u5305",
          legacyPackageConflict: "\u65E7\u5F0F\u5305\u51B2\u7A81",
          rangeInvalid: "\u8303\u56F4\u65E0\u6548",
          invalidPackage: "\u5305\u540D\u65E0\u6548",
          transitiveRemove: "\u4E0D\u80FD\u5355\u72EC\u79FB\u9664\u4F20\u9012\u4F9D\u8D56",
          maxUpdates: "\u89E3\u6790\u8F6E\u6570\u8D85\u9650",
          missingHash: "\u7F3A\u5C11 SHA-256",
          missingSource: "\u7F3A\u5C11\u4E0B\u8F7D\u5730\u5740"
        },
        risk: {
          yanked: "\u5DF2 yanked",
          prerelease: "\u9884\u53D1\u5E03",
          missingHash: "\u7F3A\u5C11 hash"
        },
        warn: {
          yanked: "\u7248\u672C\u5DF2\u88AB yanked\uFF0C\u4F46\u5F53\u524D\u9501\u5B9A\u7248\u672C\u4ECD\u53EF\u4FDD\u7559\u3002",
          prerelease: "\u9009\u62E9\u4E86\u9884\u53D1\u5E03\u7248\u672C\u3002",
          lockedPrerelease: "\u9501\u5B9A\u7248\u672C\u662F\u9884\u53D1\u5E03\u7248\u672C\u3002",
          installedFallback: "\u4ED3\u5E93\u91CC\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7248\u672C\uFF0C\u4FDD\u7559\u5DF2\u5B89\u88C5\u7248\u672C\u3002",
          missingHash: "\u7F3A\u5C11 SHA-256\uFF0C\u4E0D\u80FD\u8FDB\u5165\u5B89\u88C5\u4E8B\u52A1\u3002",
          unlisted: "\u8FD9\u662F\u672A\u5217\u5165 manifest \u7684\u672C\u5730/\u624B\u52A8\u5305\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u79FB\u9664\u3002",
          reinstallNotInstalled: "\u91CD\u88C5\u8BF7\u6C42\u5BF9\u5E94\u7684\u5305\u5F53\u524D\u6CA1\u6709\u5B89\u88C5\u3002",
          invalidCatalogEntry: "\u4ED3\u5E93\u91CC\u6709\u65E0\u6548\u7684\u5019\u9009\uFF0C\u5DF2\u8DF3\u8FC7\u3002",
          maxUpdates: "\u89E3\u6790\u66F4\u65B0\u6B21\u6570\u8FBE\u5230\u4E0A\u9650\uFF0C\u7ED3\u679C\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002"
        }
      },
      warnings: {
        vpmDataRootUnc: "\u8FD9\u662F\u7F51\u7EDC\u5171\u4EAB\u8DEF\u5F84\uFF0C\u901F\u5EA6\u548C\u53EF\u7528\u6027\u53D6\u51B3\u4E8E\u7F51\u7EDC\u3002",
        vpmDataRootRemovable: "\u8FD9\u662F\u53EF\u79FB\u52A8\u76D8\uFF0C\u62D4\u51FA\u540E\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u4F1A\u8FDB\u5165\u964D\u7EA7\u72B6\u6001\u3002",
        vpmDataRootNonNtfs: "\u8BE5\u78C1\u76D8\u4E0D\u662F NTFS\uFF0C\u6743\u9650\u4E0E\u957F\u8DEF\u5F84\u884C\u4E3A\u53EF\u80FD\u4E0D\u540C\u3002",
        vpmProjectSymlinkSkipped: "\u8FD9\u4E2A\u5DE5\u7A0B\u91CC\u6709\u7B26\u53F7\u94FE\u63A5\u6216 junction\uFF0C\u5DF2\u8DF3\u8FC7\uFF0C\u4E0D\u8DDF\u968F\u8BFB\u53D6\u3002",
        vpmProjectDuplicatePackage: "\u8FD9\u4E2A\u5DE5\u7A0B\u91CC\u6709\u91CD\u590D\u5305\u76EE\u5F55\uFF0C\u53EA\u4FDD\u7559\u7B2C\u4E00\u6761\u5E76\u6807\u51FA\u8B66\u544A\u3002",
        vpmProjectScanTruncated: "\u5DE5\u7A0B\u626B\u63CF\u8FBE\u5230\u4E0A\u9650\uFF0C\u7ED3\u679C\u662F\u90E8\u5206\u7ED3\u679C\u3002",
        vpmProjectPackageInvalid: "\u6709\u5305\u7684 package.json \u65E0\u6548\uFF0C\u5DF2\u8DF3\u8FC7\u8FD9\u4E2A\u5305\u3002",
        vpmProjectMissingPackage: "manifest \u91CC\u6709\u8FD9\u4E2A\u5305\uFF0C\u4F46 Packages \u76EE\u5F55\u91CC\u6CA1\u6709\u3002",
        vpmProjectVersionMismatch: "\u5305\u76EE\u5F55\u91CC\u7684\u7248\u672C\u4E0E vpm-manifest \u4E0D\u4E00\u81F4\u3002",
        vpmLegacyCleanupSkipped: "\u65E7 Assets \u8D44\u6E90\u6CA1\u6709\u5168\u90E8\u6E05\u7406\uFF1B\u65E0\u6CD5\u786E\u8BA4\u5F52\u5C5E\u6216\u5C5E\u4E8E\u53D7\u4FDD\u62A4\u5185\u5BB9\u7684\u5DF2\u4FDD\u7559\u3002",
        vpmLegacyCleanupFailed: "\u65E7 Assets \u8D44\u6E90\u6E05\u7406\u5931\u8D25\uFF1B\u5305\u5DF2\u7ECF\u88C5\u597D\uFF0C\u65E7\u6587\u4EF6\u4ECD\u5728\u5DE5\u7A0B\u91CC\u3002",
        vpmVaultPending: "\u65E7\u6587\u4EF6\u8FD8\u7559\u5728\u5DE5\u7A0B\u7684\u4E34\u65F6\u4E8B\u52A1\u533A\uFF0C\u5C1A\u672A\u5F52\u6863\u5230\u56DE\u6EDA\u4ED3\uFF1B\u53EF\u4EE5\u7A0D\u540E\u91CD\u8BD5\u5F52\u6863\u3002"
      },
      errors: {
        vpmDisabled: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u5F53\u524D\u662F\u5173\u95ED\u7684\u3002",
        vpmSafeMode: "\u5B89\u5168\u6A21\u5F0F\u963B\u6B62\u4E86\u8FD9\u6B21\u64CD\u4F5C\u3002",
        vpmDataRootRequired: "\u8BF7\u9009\u62E9\u4E00\u4E2A\u6570\u636E\u6839\u3002",
        vpmDataRootInvalid: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u80FD\u4F5C\u4E3A\u6570\u636E\u6839\uFF08\u7A7A\u3001\u76F8\u5BF9\u8DEF\u5F84\u3001\u76D8\u7B26\u6839\u6216\u542B\u975E\u6CD5\u5B57\u7B26\uFF09\u3002",
        vpmDataRootOnSystemDrive: "\u6570\u636E\u6839\u4E0D\u80FD\u653E\u5728\u7CFB\u7EDF\u76D8\u3002",
        vpmDataRootInsideLibrary: "\u6570\u636E\u6839\u4E0D\u80FD\u653E\u5728\u7D20\u6750\u5E93\u91CC\u9762\u3002",
        vpmDataRootInsideProject: "\u6570\u636E\u6839\u4E0D\u80FD\u653E\u5728\u73B0\u6709 Unity \u5DE5\u7A0B\u91CC\u9762\u3002",
        vpmDataRootInsideApp: "\u6570\u636E\u6839\u4E0D\u80FD\u653E\u5728\u5E94\u7528\u5B89\u88C5\u76EE\u5F55\u91CC\u9762\u3002",
        vpmDataRootNotWritable: "\u8FD9\u4E2A\u76EE\u5F55\u65E0\u6CD5\u521B\u5EFA\u6587\u4EF6\uFF0C\u8BF7\u6362\u4E00\u4E2A\u53EF\u5199\u76EE\u5F55\u3002",
        vpmSnapshotFailed: "\u542F\u7528\u524D\u5FEB\u7167\u521B\u5EFA\u5931\u8D25\uFF0C\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u672A\u542F\u7528\u3002",
        vpmConfigRecovered: "\u8BBE\u7F6E\u6587\u4EF6\u635F\u574F\uFF0C\u539F\u6587\u4EF6\u5DF2\u5907\u4EFD\u4E3A .corrupt-*\uFF0C\u5F53\u524D\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002",
        vpmDbOpenFailed: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u6570\u636E\u5E93\u65E0\u6CD5\u6253\u5F00\uFF1B\u6838\u5FC3\u7D20\u6750\u529F\u80FD\u4E0D\u53D7\u5F71\u54CD\u3002",
        vpmDbVersionTooNew: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u6570\u636E\u5E93\u7248\u672C\u9AD8\u4E8E\u5F53\u524D\u7A0B\u5E8F\uFF1B\u8BF7\u5347\u7EA7 Atrium\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u5EFA\u3002",
        vpmDbMigrationFailed: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u6570\u636E\u5E93\u5347\u7EA7\u5931\u8D25\uFF1B\u539F\u6570\u636E\u5DF2\u4FDD\u7559\u3002",
        vpmDbBackupFailed: "\u5347\u7EA7\u524D\u5907\u4EFD\u6570\u636E\u5E93\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\u5347\u7EA7\u3002",
        vpmDbIntegrityFailed: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u6570\u636E\u5E93\u5B8C\u6574\u6027\u68C0\u67E5\u5931\u8D25\u3002",
        vpmRepoInvalid: "\u4ED3\u5E93\u4FE1\u606F\u4E0D\u5B8C\u6574\u6216\u683C\u5F0F\u4E0D\u5BF9\u3002",
        vpmRepoConflict: "\u5DF2\u7ECF\u6709\u76F8\u540C\u5730\u5740\u7684\u4ED3\u5E93\u3002",
        vpmRepoNotFound: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4ED3\u5E93\u3002",
        vpmVersionInvalid: "\u7248\u672C\u53F7\u4E0D\u662F\u6709\u6548\u7684 SemVer 2.0\u3002",
        vpmRangeInvalid: "\u7248\u672C\u8303\u56F4\u5199\u6CD5\u65E0\u6548\u6216\u4E0D\u53D7\u652F\u6301\u3002",
        vpmUnityVersionInvalid: "Unity \u7248\u672C\u53F7\u65E0\u6548\u3002",
        vpmPackageIdInvalid: "\u5305\u540D\u4E0D\u662F\u6709\u6548\u7684 VPM \u5305 ID\uFF08\u6216\u5305\u542B Windows \u4FDD\u7559\u540D/\u975E\u6CD5\u5B57\u7B26\uFF09\u3002",
        vpmResolutionFailed: "\u4F9D\u8D56\u89E3\u6790\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u51B2\u7A81\u548C\u7F3A\u5931\u9879\u3002",
        vpmPlanNotFound: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u8BA1\u5212\uFF1B\u8BF7\u91CD\u65B0\u9884\u89C8\u3002",
        vpmPlanExpired: "\u8BA1\u5212\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u3002",
        vpmPlanChanged: "\u5DE5\u7A0B\u5728\u9884\u89C8\u540E\u53D1\u751F\u4E86\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u3002",
        vpmProjectInvalid: "\u8FD9\u4E0D\u662F\u6709\u6548\u7684 Unity \u5DE5\u7A0B\uFF0C\u6216\u5DE5\u7A0B\u7248\u672C\u6587\u4EF6\u635F\u574F\u3002",
        vpmManifestInvalid: "vpm-manifest.json \u65E0\u6CD5\u89E3\u6790\uFF1B\u5DE5\u7A0B\u5176\u4ED6\u5185\u5BB9\u4ECD\u53EF\u8BFB\u53D6\u3002",
        vpmProjectPackagesUnreadable: "\u65E0\u6CD5\u8BFB\u53D6 Packages \u76EE\u5F55\uFF1B\u5DE5\u7A0B\u4ECD\u53EF\u4EE5\u6253\u5F00\u3002",
        vpmProjectAccessDenied: "\u6CA1\u6709\u6743\u9650\u8BFB\u53D6\u8FD9\u4E2A\u5DE5\u7A0B\u7684\u90E8\u5206\u6587\u4EF6\u3002",
        vpmProjectBusy: "\u8FD9\u4E2A\u5DE5\u7A0B\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u64CD\u4F5C\uFF0C\u8BF7\u7B49\u5B83\u7ED3\u675F\u6216\u5148\u6062\u590D\u3002",
        vpmOperationNotFound: "\u627E\u4E0D\u5230\u8FD9\u6B21\u64CD\u4F5C\u7684\u8BB0\u5F55\u3002",
        vpmOperationInvalid: "\u5F53\u524D\u72B6\u6001\u4E0D\u5141\u8BB8\u8FD9\u4E00\u6B65\uFF0C\u5DF2\u505C\u6B62\u3002",
        vpmJournalInvalid: "\u64CD\u4F5C\u8BB0\u5F55\u7F3A\u5931\u6216\u635F\u574F\uFF0C\u9700\u8981\u5148\u786E\u8BA4\u5DE5\u7A0B\u6587\u4EF6\u662F\u5426\u5B8C\u6574\u3002",
        vpmJournalWriteFailed: "\u65E0\u6CD5\u5199\u5165\u64CD\u4F5C\u8BB0\u5F55\uFF0C\u672C\u6B21\u64CD\u4F5C\u5DF2\u505C\u6B62\u3002",
        vpmRecoveryRequired: "\u4E0A\u6B21\u64CD\u4F5C\u6CA1\u6709\u5B8C\u6210\uFF0C\u8BF7\u5148\u6062\u590D\uFF1B\u73B0\u5728\u4E0D\u8981\u7528 Unity \u6253\u5F00\u5E76\u4FDD\u5B58\u8FD9\u4E2A\u5DE5\u7A0B\u3002",
        vpmUnityNotFound: "\u627E\u4E0D\u5230\u8FD9\u4E2A Unity \u7F16\u8F91\u5668\u8DEF\u5F84\u3002",
        vpmUnityLaunchFailed: "\u542F\u52A8 Unity \u5931\u8D25\uFF08{{reason}}\uFF09\u3002",
        vpmUnityInvalid: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u662F\u6709\u6548\u7684 Unity \u7F16\u8F91\u5668\uFF08\u9700\u8981 Unity.exe\uFF09\u3002",
        vpmUnityAccessDenied: "\u6CA1\u6709\u6743\u9650\u8BFB\u53D6\u8FD9\u4E2A Unity \u7F16\u8F91\u5668\u8DEF\u5F84\u3002",
        vpmUnityVersionUnknown: "\u65E0\u6CD5\u4ECE\u8DEF\u5F84\u8BC6\u522B Unity \u7248\u672C\uFF0C\u8BF7\u624B\u52A8\u586B\u5199\u7248\u672C\u3002",
        vpmNetworkNotConsented: "\u8FD8\u6CA1\u6709\u540C\u610F\u8054\u7F51\uFF1B\u5F53\u524D\u53EA\u80FD\u4F7F\u7528\u672C\u5730/\u7F13\u5B58\u6570\u636E\u3002",
        vpmHttpBlocked: "\u8FD9\u4E2A\u5730\u5740\u4E0D\u5141\u8BB8\u8BBF\u95EE\uFF08\u53EA\u5141\u8BB8 HTTPS\uFF0C\u4E14\u4E0D\u80FD\u5E26\u51ED\u636E\uFF09\u3002",
        vpmHttpTimeout: "\u7F51\u7EDC\u8BF7\u6C42\u8D85\u65F6\u3002",
        vpmHttpTooLarge: "\u670D\u52A1\u5668\u8FD4\u56DE\u7684\u5185\u5BB9\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650\u3002",
        vpmHttpStatus: "\u670D\u52A1\u5668\u8FD4\u56DE\u4E86\u9519\u8BEF\u72B6\u6001\u3002",
        vpmHttpRedirect: "\u91CD\u5B9A\u5411\u4E0D\u5B89\u5168\u6216\u6B21\u6570\u8FC7\u591A\uFF0C\u5DF2\u505C\u6B62\u3002",
        vpmHttpNetwork: "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\u3002",
        vpmHttpInvalidJson: "\u670D\u52A1\u5668\u8FD4\u56DE\u7684\u4E0D\u662F\u6709\u6548 JSON\u3002",
        vpmHttpAborted: "\u7F51\u7EDC\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002",
        vpmCachePathInvalid: "\u7F13\u5B58\u8DEF\u5F84\u4E0D\u5728\u6570\u636E\u6839\u5185\uFF0C\u5DF2\u62D2\u7EDD\u3002",
        vpmCacheWriteFailed: "\u7F13\u5B58\u6587\u4EF6\u5199\u5165\u5931\u8D25\u3002",
        vpmCacheHashMismatch: "\u7F13\u5B58\u6587\u4EF6\u6821\u9A8C\u5931\u8D25\uFF0C\u5185\u5BB9\u4E0D\u5339\u914D\u3002",
        vpmCacheHashMissing: "\u8FD9\u4E2A\u5305\u6CA1\u6709 SHA-256\uFF0C\u4E0D\u80FD\u4E0B\u8F7D\u6216\u5B89\u88C5\u3002",
        vpmCacheQuotaExceeded: "\u7F13\u5B58\u8D85\u8FC7\u914D\u989D\uFF0C\u8BF7\u5148\u6E05\u7406\u7F13\u5B58\u6216\u8C03\u5927\u914D\u989D\u3002",
        vpmCacheNoSpace: "\u7F13\u5B58\u6240\u5728\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8BF7\u6E05\u7406\u78C1\u76D8\u540E\u91CD\u8BD5\u3002",
        vpmArchiveInvalid: "\u538B\u7F29\u5305\u635F\u574F\u6216\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\u3002",
        vpmArchiveUnsafePath: "\u538B\u7F29\u5305\u91CC\u6709\u4E0D\u5B89\u5168\u7684\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\u3001..\u3001\u4FDD\u7559\u540D\u6216\u91CD\u590D\u8DEF\u5F84\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u3002",
        vpmArchiveSymlink: "\u538B\u7F29\u5305\u91CC\u5305\u542B\u7B26\u53F7\u94FE\u63A5\u6216\u786C\u94FE\u63A5\uFF0C\u5DF2\u62D2\u7EDD\u3002",
        vpmArchiveBomb: "\u538B\u7F29\u5305\u6761\u76EE\u6216\u5C55\u5F00\u5927\u5C0F\u5F02\u5E38\uFF0C\u53EF\u80FD\u662F\u538B\u7F29\u70B8\u5F39\uFF0C\u5DF2\u62D2\u7EDD\u3002",
        vpmArchivePackageInvalid: "\u89E3\u538B\u540E\u627E\u4E0D\u5230\u552F\u4E00\u7684 package.json\uFF0C\u6216\u5305\u540D/\u7248\u672C\u4E0E\u8BA1\u5212\u4E0D\u4E00\u81F4\u3002",
        vpmArchiveWriteFailed: "\u89E3\u538B\u5199\u5165\u5931\u8D25\uFF0C\u4E34\u65F6\u76EE\u5F55\u5DF2\u4FDD\u7559\u3002",
        vpmRuntimeNotReady: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u7684\u8FD0\u884C\u65F6\u8FD8\u6CA1\u6709\u5C31\u7EEA\uFF1B\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF0C\u6216\u91CD\u65B0\u542F\u7528\u3002",
        vpmPlanBlocked: "\u8FD9\u4E2A\u8BA1\u5212\u8FD8\u6709\u51B2\u7A81\u6216\u7F3A\u5931\u4F9D\u8D56\uFF0C\u5148\u89E3\u51B3\u5B83\u4EEC\u518D\u5E94\u7528\u3002",
        vpmProjectChanged: "\u5DE5\u7A0B\u5728\u9884\u89C8\u4E4B\u540E\u88AB\u6539\u8FC7\uFF08manifest \u6216\u5305\u76EE\u5F55\uFF09\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u3002",
        vpmUnityRunning: "Unity \u6B63\u5728\u8FD0\u884C\u8FD9\u4E2A\u5DE5\u7A0B\u3002\u8BF7\u5148\u5173\u95ED Unity\uFF0C\u518D\u5B89\u88C5\u6216\u5378\u8F7D\u5305\u3002",
        vpmProjectImporting: "\u7D20\u6750\u6B63\u5728\u5BFC\u5165\u8FD9\u4E2A\u5DE5\u7A0B\u3002\u8BF7\u7B49\u5BFC\u5165\u7ED3\u675F\uFF0C\u518D\u5B89\u88C5\u6216\u5378\u8F7D\u5305\u3002",
        vpmProtectedPackage: "\u53D7\u4FDD\u62A4\u7684\u5305\u4E0D\u80FD\u5347\u7EA7\u3001\u964D\u7EA7\u6216\u5378\u8F7D\uFF1A{{name}}\u3002",
        vpmProjectNoSpace: "\u5DE5\u7A0B\u6240\u5728\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u81F3\u5C11\u8FD8\u9700\u8981 {{required}} \u5B57\u8282\u3002",
        vpmProjectPathUnsafe: "\u5DE5\u7A0B\u91CC\u7684\u76EE\u6807\u8DEF\u5F84\u4E0D\u5B89\u5168\uFF08\u7B26\u53F7\u94FE\u63A5\u3001junction \u6216\u540C\u540D\u6587\u4EF6\uFF09\uFF0C\u5DF2\u505C\u6B62\u3002",
        vpmTransactionFailed: "\u5B89\u88C5\u4E8B\u52A1\u6267\u884C\u5931\u8D25\uFF1B\u5DE5\u7A0B\u5DF2\u6309\u8BB0\u5F55\u6062\u590D\u6216\u4FDD\u7559\u73B0\u573A\u3002",
        vpmRollbackFailed: "\u56DE\u6EDA\u6CA1\u6709\u5B8C\u5168\u6210\u529F\uFF0C\u5DE5\u7A0B\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\uFF1B\u73B0\u573A\u5DF2\u4FDD\u7559\uFF0C\u672A\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002",
        vpmVaultUnavailable: "\u56DE\u6EDA\u4ED3\u4E0D\u53EF\u7528\uFF08\u65E0\u6CD5\u521B\u5EFA\u6216\u5199\u5165\uFF09\uFF1B\u6CA1\u6709\u56DE\u6EDA\u4ED3\u5C31\u4E0D\u6539\u5DE5\u7A0B\u3002",
        vpmVaultArchiveFailed: "\u65E7\u6587\u4EF6\u6CA1\u80FD\u5F52\u6863\u5230\u56DE\u6EDA\u4ED3\uFF1B\u5B83\u4EEC\u4ECD\u5728\u5DE5\u7A0B\u7684\u4E34\u65F6\u4E8B\u52A1\u533A\uFF0C\u53EF\u7A0D\u540E\u91CD\u8BD5\u3002",
        vpmUndoUnsafe: "\u64A4\u9500\u4E0D\u5B89\u5168\uFF1A\u5DE5\u7A0B\u5728\u8FD9\u6B21\u64CD\u4F5C\u4E4B\u540E\u88AB\u6539\u8FC7\u3001\u6216\u5B83\u4E0D\u662F\u6700\u540E\u4E00\u6B21\u64CD\u4F5C\uFF08{{reason}}\uFF09\u3002",
        vpmCancelTooLate: "\u8FD9\u6B21\u64CD\u4F5C\u5DF2\u7ECF\u8FC7\u4E86\u63D0\u4EA4\u70B9\uFF0C\u53D6\u6D88\u6765\u4E0D\u53CA\u4E86\uFF1B\u5B83\u4F1A\u7EE7\u7EED\u8DD1\u5B8C\u3002",
        vpmTemplateNotFound: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u6A21\u677F\u3002",
        vpmTemplateInvalid: "\u6A21\u677F\u6587\u4EF6\u4E0D\u5408\u6CD5\uFF1A{{reason}}\u3002",
        vpmTemplateReadOnly: "\u5185\u7F6E\u6A21\u677F\u4E0D\u80FD\u7F16\u8F91\u6216\u5220\u9664\u3002",
        vpmTemplateWriteFailed: "\u5199\u5165\u6A21\u677F\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6570\u636E\u6839\u662F\u5426\u53EF\u5199\u3002",
        vpmCreateRejected: "\u4E0D\u80FD\u5728\u8FD9\u4E2A\u4F4D\u7F6E\u65B0\u5EFA\u5DE5\u7A0B\uFF1A{{reason}}\u3002",
        vpmCreateFailed: "\u65B0\u5EFA\u5DE5\u7A0B\u5931\u8D25\uFF08\u73B0\u573A\u5DF2\u4FDD\u7559\uFF0C\u7F16\u53F7 {{opId}}\uFF09\u3002",
        vpmCollectCancelled: "\u6536\u96C6\u5DE5\u7A0B\u6587\u4EF6\u65F6\u88AB\u53D6\u6D88\uFF0C\u6CA1\u6709\u7EE7\u7EED\u904D\u5386\u3002",
        vpmBackupCancelled: "\u5907\u4EFD\u5DF2\u53D6\u6D88\uFF0C\u6CA1\u6709\u7559\u4E0B\u534A\u6210\u54C1\u3002",
        vpmBackupFailed: "\u5907\u4EFD\u5931\u8D25\uFF08{{reason}}\uFF09\uFF0C\u4E34\u65F6\u6587\u4EF6\u5DF2\u6E05\u7406\u3002",
        vpmBackupInvalid: "\u8FD9\u4E2A\u5907\u4EFD\u6587\u4EF6\u8BFB\u4E0D\u51FA\u6765\u6216\u5DF2\u635F\u574F\u3002",
        vpmBackupUnsafe: "\u5907\u4EFD\u91CC\u6709\u4E0D\u5B89\u5168\u7684\u8DEF\u5F84\uFF0C\u5DF2\u62D2\u7EDD\uFF08{{path}}\uFF09\u3002",
        vpmBackupTooLarge: "\u5907\u4EFD\u8D85\u51FA\u5927\u5C0F\u9650\u5236\uFF08{{limit}}\uFF09\u3002",
        vpmBackupConflict: "\u76EE\u6807\u4F4D\u7F6E\u5DF2\u7ECF\u6709\u4E1C\u897F\u4E86\uFF0C\u4E0D\u4F1A\u8986\u76D6\u3002",
        vpmCopyConflict: "\u76EE\u6807\u4F4D\u7F6E\u5DF2\u7ECF\u6709\u4E1C\u897F\u4E86\uFF0C\u4E0D\u4F1A\u8986\u76D6\u3002",
        vpmSecretUnavailable: "\u7CFB\u7EDF\u52A0\u5BC6\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u8BF7\u6C42\u5934\uFF08\u4E0D\u4F1A\u4EE5\u660E\u6587\u4FDD\u5B58\uFF09\u3002",
        vpmSecretInvalid: "\u8BF7\u6C42\u5934\u4E0D\u5408\u6CD5\uFF08{{field}}\uFF09\u3002",
        vpmCopyFailed: "\u590D\u5236\u5DE5\u7A0B\u5931\u8D25\uFF08{{reason}}\uFF09\uFF0C\u4E34\u65F6\u76EE\u5F55\u5DF2\u4FDD\u7559\u3002",
        vpmUnityVersionChangeFailed: "\u66F4\u6362 Unity \u7248\u672C\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u539F\u7248\u672C\u6587\u4EF6\u3002",
        vpmUnityPackageInvalid: "\u8FD9\u4E2A unitypackage \u8BFB\u4E0D\u51FA\u6765\u6216\u7ED3\u6784\u4E0D\u5BF9\u3002",
        vpmUnityPackageUnsafe: "\u5305\u91CC\u6709\u4E0D\u5B89\u5168\u7684\u8DEF\u5F84\uFF0C\u5DF2\u62D2\u7EDD\u89E3\u5305\uFF08{{path}}\uFF09\u3002",
        vpmUnityPackageConflict: "\u5DE5\u7A0B\u91CC\u5DF2\u7ECF\u6709\u8FD9\u4E2A\u6587\u4EF6\uFF0C\u672A\u8986\u76D6\uFF08{{path}}\uFF09\u3002",
        vpmUnityPackageTooLarge: "\u5305\u592A\u5927\u6216\u6761\u76EE\u592A\u591A\uFF0C\u5DF2\u62D2\u7EDD\uFF08{{limit}}\uFF09\u3002",
        vpmUnityPackageFailed: "\u89E3\u5305\u4E2D\u9014\u5931\u8D25\uFF0C\u5DF2\u7ECF\u56DE\u6EDA\uFF08\u5DF2\u642C {{moved}} \u4E2A\u6587\u4EF6\uFF09\u3002",
        vpmInternal: "\u9879\u76EE\u4E0E\u5305\u7BA1\u7406\u9047\u5230\u5185\u90E8\u9519\u8BEF\uFF1B\u6838\u5FC3\u7D20\u6750\u529F\u80FD\u672A\u53D7\u5F71\u54CD\u3002"
      },
      packages: {
        title: "\u5DF2\u5B89\u88C5\u7684\u5305",
        installedCount: "\u5DF2\u88C5 {{count}} \u4E2A",
        updatesCount: "\u53EF\u66F4\u65B0 {{count}} \u4E2A",
        upgradeAll: "\u5347\u7EA7\u5168\u90E8\uFF08\u6700\u65B0\uFF09",
        lockedHint: "Unity \u6B63\u5728\u8FD0\u884C\u6216\u5DF2\u6709\u64CD\u4F5C\u5728\u8FDB\u884C\uFF0C\u6682\u65F6\u4E0D\u80FD\u6539\u5305",
        unityRunning: "Unity \u6B63\u5728\u8FD0\u884C\u8FD9\u4E2A\u5DE5\u7A0B\u3002\u5173\u95ED Unity \u4E4B\u540E\u624D\u80FD\u88C5\u5305\u6216\u5378\u8F7D\u5305\u3002",
        search: "\u641C\u7D22\u5305\u540D",
        filter: {
          label: "\u7B5B\u9009\u8F6F\u4EF6\u5305",
          all: "\u5168\u90E8",
          installed: "\u5DF2\u5B89\u88C5",
          updates: "\u53EF\u66F4\u65B0",
          conflicts: "\u6709\u51B2\u7A81"
        },
        col: {
          name: "\u5305\u540D",
          version: "\u5DF2\u5B89\u88C5\u7248\u672C",
          latest: "\u6700\u65B0\u7248\u672C",
          status: "\u72B6\u6001"
        },
        empty: "\u6CA1\u6709\u5339\u914D\u7684\u5305\u3002",
        system: "\u7CFB\u7EDF\u5305",
        systemHint: "\u7531 Atrium \u6865\u63A5\u5B89\u88C5\u5668\u7EF4\u62A4\uFF0C\u4E0D\u80FD\u5728\u8FD9\u91CC\u5347\u7EA7\u3001\u964D\u7EA7\u6216\u5378\u8F7D\u3002",
        updateAvailable: "\u6709\u66F4\u65B0",
        conflict: "\u591A\u6E90\u51B2\u7A81",
        current: "\uFF08\u5F53\u524D\uFF09",
        reinstall: "\u91CD\u88C5",
        remove: "\u79FB\u9664",
        removeTitle: "\u79FB\u9664\u8FD9\u4E2A\u5305\uFF1F",
        removeBody: "\u5305\u76EE\u5F55\u4F1A\u5148\u79FB\u5230\u5DE5\u7A0B\u7684\u4E34\u65F6\u4E8B\u52A1\u533A\uFF0C\u6210\u529F\u540E\u5F52\u6863\u5230\u56DE\u6EDA\u4ED3\uFF1B\u4E0D\u4F1A\u6C38\u4E45\u5220\u9664\u3002",
        cart: {
          summary: "\u5DF2\u9009 {{count}} \u9879\u53D8\u66F4",
          clear: "\u6E05\u7A7A",
          view: "\u67E5\u770B\u66F4\u6539"
        },
        planHint: "\u4E0B\u9762\u662F\u8981\u5199\u8FDB\u5DE5\u7A0B\u7684\u53D8\u5316\uFF1B\u786E\u8BA4\u540E\u624D\u4F1A\u5F00\u59CB\u4E0B\u8F7D\u548C\u66FF\u6362\u6587\u4EF6\u3002",
        apply: {
          ackFirst: "\u5148\u52FE\u9009\u4E0A\u9762\u7684\u98CE\u9669\u786E\u8BA4",
          risk: "\u6211\u77E5\u9053\u8FD9\u6B21\u64CD\u4F5C\u4F1A\u4FEE\u6539\u5DE5\u7A0B\u6587\u4EF6\uFF08Packages/ \u4E0E vpm-manifest.json\uFF09\u3002\u5305\u53EF\u80FD\u5E26\u7F16\u8F91\u5668\u811A\u672C\uFF0C\u6253\u5F00 Unity \u540E\u4F1A\u6267\u884C\u3002",
          confirm: "\u786E\u8BA4\u5E94\u7528",
          noChanges: "\u8FD9\u4E2A\u8BA1\u5212\u6CA1\u6709\u4EFB\u4F55\u53D8\u66F4\u3002"
        },
        run: {
          title: "\u6B63\u5728\u5E94\u7528\u53D8\u66F4",
          resultTitle: "\u64CD\u4F5C\u7ED3\u679C",
          running: "\u8FDB\u884C\u4E2D",
          starting: "\u6B63\u5728\u51C6\u5907\u2026",
          hint: "\u4E0B\u8F7D\u4E0E\u89E3\u538B\u9636\u6BB5\u53EF\u4EE5\u53D6\u6D88\uFF1B\u63D0\u4EA4\u70B9\uFF08manifest \u5199\u5165\uFF09\u4E4B\u540E\u4E0D\u80FD\u53D6\u6D88\u3002",
          cancel: "\u53D6\u6D88",
          cancelling: "\u6B63\u5728\u53D6\u6D88\u2026",
          close: "\u5173\u95ED",
          undo: "\u64A4\u9500\u8FD9\u6B21\u64CD\u4F5C",
          installed: "\u5DF2\u5B89\u88C5",
          removed: "\u5DF2\u79FB\u9664",
          rolledBack: "\u5DF2\u7ECF\u56DE\u6EDA\uFF0C\u5DE5\u7A0B\u56DE\u5230\u64CD\u4F5C\u524D\u7684\u72B6\u6001\u3002",
          needsAttention: "\u64CD\u4F5C\u6CA1\u6709\u5B8C\u5168\u6536\u5C3E\uFF0C\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\uFF1B\u73B0\u573A\u5DF2\u4FDD\u7559\uFF0C\u6CA1\u6709\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\u3002",
          vaultPending: "\u65E7\u6587\u4EF6\u8FD8\u5728\u5DE5\u7A0B\u7684\u4E8B\u52A1\u533A\uFF0C\u5C1A\u672A\u5F52\u6863\u5230\u56DE\u6EDA\u4ED3\uFF1B\u53EF\u4EE5\u7A0D\u540E\u91CD\u8BD5\u5F52\u6863\u3002",
          status: {
            planned: "\u5DF2\u8BA1\u5212",
            preflight: "\u9884\u68C0\u4E2D",
            applying: "\u6267\u884C\u4E2D",
            committed: "\u5DF2\u5B8C\u6210",
            failed: "\u5931\u8D25",
            rolled_back: "\u5DF2\u56DE\u6EDA",
            needs_attention: "\u9700\u8981\u5904\u7406"
          }
        },
        step: {
          prepare: "\u51C6\u5907\u4E8B\u52A1\u533A",
          download: "\u4E0B\u8F7D\u5305",
          extract: "\u89E3\u538B\u4E0E\u6821\u9A8C",
          "move-out": "\u79FB\u51FA\u65E7\u5305",
          "move-in": "\u6362\u5165\u65B0\u5305",
          manifest: "\u5199\u5165 manifest",
          legacy: "\u6E05\u7406\u65E7 Assets",
          vault: "\u5F52\u6863\u5230\u56DE\u6EDA\u4ED3",
          cleanup: "\u6E05\u7406\u4E34\u65F6\u533A",
          rollback: "\u56DE\u6EDA"
        },
        history: {
          title: "\u6700\u8FD1\u64CD\u4F5C",
          loading: "\u8BFB\u53D6\u4E2D\u2026",
          refresh: "\u5237\u65B0",
          empty: "\u8FD8\u6CA1\u6709\u64CD\u4F5C\u8BB0\u5F55\u3002",
          changes: "{{count}} \u9879\u53D8\u66F4",
          undo: "\u64A4\u9500"
        },
        undoBlocked: {
          notCommitted: "\u53EA\u6709\u6210\u529F\u7684\u64CD\u4F5C\u53EF\u4EE5\u64A4\u9500",
          notLatest: "\u4E0D\u662F\u6700\u540E\u4E00\u6B21\u64CD\u4F5C",
          projectChanged: "\u5DE5\u7A0B\u5728\u90A3\u4E4B\u540E\u88AB\u6539\u8FC7",
          unityRunning: "Unity \u6B63\u5728\u8FD0\u884C",
          busy: "\u6709\u64CD\u4F5C\u6B63\u5728\u8FDB\u884C",
          noReverse: "\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u53D8\u66F4",
          unsupported: "\u4E0D\u80FD\u64A4\u9500"
        },
        kind: {
          install: "\u5B89\u88C5",
          remove: "\u5378\u8F7D",
          upgrade: "\u5347\u7EA7",
          undo: "\u64A4\u9500"
        }
      },
      create: {
        title: "\u65B0\u5EFA\u5DE5\u7A0B",
        intro: '\u9009\u4E00\u4E2A\u6A21\u677F\uFF0C\u586B\u540D\u79F0\u548C\u4F4D\u7F6E\u3002\u4F9D\u8D56\u4F1A\u5728\u5EFA\u5B8C\u540E\u6309\u6B63\u5E38\u6D41\u7A0B\u5B89\u88C5\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u6253\u5F00 Unity\uFF0C\u9664\u975E\u4F60\u70B9\u4E86"\u6253\u5F00 Unity"\u3002',
        template: "\u6A21\u677F",
        loading: "\u8BFB\u53D6\u6A21\u677F\u2026",
        builtin: "\u5185\u7F6E",
        favorite: "\u6536\u85CF",
        counts: "{{deps}} \u4E2A\u4F9D\u8D56 \xB7 {{files}} \u4E2A\u9644\u4EF6",
        setFavorite: "\u6536\u85CF",
        unfavorite: "\u53D6\u6D88\u6536\u85CF",
        name: "\u5DE5\u7A0B\u540D\u79F0",
        nameHint: '\u4F1A\u6210\u4E3A\u6587\u4EF6\u5939\u540D\uFF1B\u4E0D\u80FD\u5305\u542B < > : " / \\ | ? * \u6216\u7ED3\u5C3E\u7684\u70B9/\u7A7A\u683C\u3002',
        parent: "\u4F4D\u7F6E",
        parentHint: '\u5DE5\u7A0B\u4F1A\u5EFA\u5728"\u4F4D\u7F6E/\u540D\u79F0"\u4E0B\uFF1B\u76EE\u6807\u5FC5\u987B\u4E0D\u5B58\u5728\u3002',
        pick: "\u9009\u62E9\u2026",
        pickParent: "\u9009\u62E9\u65B0\u5DE5\u7A0B\u7684\u4F4D\u7F6E",
        unityVersion: "Unity \u7248\u672C",
        unityHint: "\u53EA\u5217\u51FA\u5DF2\u53D1\u73B0\u7684\u7F16\u8F91\u5668\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u5B89\u88C5\u3002",
        inherits: "\u7EE7\u627F\u81EA {{base}}",
        submit: "\u521B\u5EFA",
        creating: "\u6B63\u5728\u521B\u5EFA\u2026",
        dependenciesFailed: "\u5DE5\u7A0B\u5DF2\u521B\u5EFA\uFF0C\u4F46\u4F9D\u8D56\u6CA1\u88C5\u5B8C\uFF1B\u53EF\u4EE5\u5728\u5217\u8868\u91CC\u91CD\u8BD5\u5B89\u88C5\u3002",
        noEditors: "\u6CA1\u63A2\u6D4B\u5230\u5DF2\u5B89\u88C5\u7684 Unity \u7F16\u8F91\u5668\uFF1A\u53EF\u4EE5\u76F4\u63A5\u586B\u7248\u672C\u53F7\u5EFA\u5DE5\u7A0B\uFF0C\u4F46\u6253\u5F00 Unity \u524D\u8981\u5148\u628A\u7F16\u8F91\u5668\u52A0\u8FDB Unity Hub\u3002",
        rescan: "\u91CD\u65B0\u626B\u63CF"
      },
      maintenance: {
        title: "\u5907\u4EFD\u4E0E\u7EF4\u62A4",
        backupCount: "{{count}} \u4E2A\u53EF\u7528\u5907\u4EFD",
        backupNow: "\u7ACB\u5373\u5907\u4EFD",
        backingUp: "\u6B63\u5728\u5907\u4EFD\u2026",
        backupDone: "\u5907\u4EFD\u5B8C\u6210\uFF08{{size}}\uFF09",
        noBackups: "\u8FD8\u6CA1\u6709\u5907\u4EFD\u3002",
        reveal: "\u6253\u5F00\u4F4D\u7F6E",
        revealFailed: "\u6253\u4E0D\u5F00\u6587\u4EF6\u4F4D\u7F6E",
        status: {
          running: "\u8FDB\u884C\u4E2D",
          ok: "\u53EF\u7528",
          failed: "\u5931\u8D25",
          cancelled: "\u5DF2\u53D6\u6D88"
        },
        copy: "\u590D\u5236\u5DE5\u7A0B",
        copying: "\u6B63\u5728\u590D\u5236\u2026",
        copyTitle: "\u590D\u5236\u5DE5\u7A0B",
        copyHint: "\u53EA\u590D\u5236\u5FC5\u8981\u6587\u4EF6\uFF08\u4E0D\u542B Library/Logs/Temp\uFF09\uFF1B\u76EE\u6807\u76EE\u5F55\u5FC5\u987B\u4E0D\u5B58\u5728\u3002",
        copyParent: "\u590D\u5236\u5230",
        copyName: "\u65B0\u6587\u4EF6\u5939\u540D",
        copyDone: "\u5DF2\u590D\u5236 {{files}} \u4E2A\u6587\u4EF6",
        changeVersion: "\u66F4\u6362 Unity \u7248\u672C",
        versionTitle: "\u66F4\u6362 Unity \u7248\u672C",
        versionHint: "\u53EA\u4F1A\u6539 ProjectVersion.txt\uFF1BUnity \u9996\u6B21\u6253\u5F00\u65F6\u4F1A\u81EA\u5DF1\u5347\u7EA7\u8D44\u6E90\u3002",
        versionWarning: "\u6362\u7248\u672C\u524D\u4F1A\u81EA\u52A8\u5907\u4EFD\u4E00\u6B21\u3002\u964D\u7EA7\u53EF\u80FD\u4E0D\u53EF\u9006\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u7ECF\u5728\u7248\u672C\u7BA1\u7406\u91CC\u7559\u8FC7\u5E95\u3002",
        versionChanging: "\u6B63\u5728\u66F4\u6362\u2026",
        versionChanged: "\u5DF2\u4ECE {{from}} \u6362\u5230 {{to}}",
        versionDowngraded: "\u5DF2\u964D\u7EA7\uFF1A{{from}} \u2192 {{to}}\uFF08\u8D44\u6E90\u4E0D\u53EF\u9006\uFF09",
        migrate: "\u8FC1\u79FB\u65E7\u8D44\u6E90\uFF08{{count}}\uFF09",
        migrateTitle: "\u8FC1\u79FB\u65E7\u5F0F\u5305",
        migrateHint: "\u53EA\u8FC1\u79FB\u52FE\u9009\u7684\u5019\u9009\uFF1A\u4F1A\u5148\u5907\u4EFD\uFF0C\u518D\u6309\u6B63\u5E38\u6D41\u7A0B\u88C5\u5305\uFF0C\u65E7 Assets \u7531\u4E8B\u52A1\u79FB\u5165\u56DE\u6EDA\u4ED3\u3002",
        migrateSelected: "\u8FC1\u79FB\u6240\u9009",
        migrating: "\u6B63\u5728\u8FC1\u79FB\u2026",
        migrateDone: "\u88C5\u597D {{installed}} \u4E2A\uFF0C\u8DF3\u8FC7 {{skipped}} \u4E2A\uFF0C\u5931\u8D25 {{failed}} \u4E2A",
        unityRunning: "Unity \u6B63\u5728\u8FD0\u884C\uFF1A\u5907\u4EFD\u53EF\u4EE5\u7EE7\u7EED\uFF0C\u4F46\u590D\u5236/\u6362\u7248\u672C/\u8FC1\u79FB\u8981\u5148\u5173\u95ED Unity\u3002",
        collecting: "\u6B63\u5728\u6536\u96C6\u2026 {{files}} \u4E2A\u6587\u4EF6",
        zipping: "\u6B63\u5728\u538B\u7F29\u2026 {{percent}}%",
        backupOk: "\u5907\u4EFD\u5B8C\u6210",
        openFolder: "\u6253\u5F00\u6240\u5728\u6587\u4EF6\u5939",
        retry: "\u91CD\u8BD5",
        more: "\u66F4\u591A\u5907\u4EFD\uFF08{{count}}\uFF09",
        less: "\u6536\u8D77"
      }
    }
  };

  // src/renderer/vpm/components/ReposPanel.tsx
  var import_react10 = __toESM(require_react());

  // src/renderer/lib/msg.ts
  function msg(key, params, fallback) {
    if (key && instance.exists(key)) return String(instance.t(key, params ?? {}));
    return fallback ?? "";
  }
  function errorText(error) {
    const text = error instanceof Error ? error.message : String(error);
    const key = text.match(/i18n:([A-Za-z0-9_.]+)/)?.[1] ?? text.match(/\b(project\.connection[A-Za-z]+)\b/)?.[1];
    return key && instance.exists(key) ? String(instance.t(key)) : text;
  }

  // node_modules/@radix-ui/react-dialog/dist/index.mjs
  var React24 = __toESM(require_react(), 1);

  // node_modules/@radix-ui/primitive/dist/index.mjs
  var __defProp2 = Object.defineProperty;
  var __name = (target, value) => __defProp2(target, "name", { value, configurable: true });
  var canUseDOM = !!(typeof window !== "undefined" && window.document && window.document.createElement);
  function composeEventHandlers(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
    return /* @__PURE__ */ __name(function handleEvent(event) {
      originalEventHandler?.(event);
      if (checkForDefaultPrevented === false || !event || !event.defaultPrevented) {
        return ourEventHandler?.(event);
      }
    }, "handleEvent");
  }
  __name(composeEventHandlers, "composeEventHandlers");
  function getOwnerWindow(element) {
    if (!canUseDOM) {
      throw new Error("Cannot access window outside of the DOM");
    }
    return element?.ownerDocument?.defaultView ?? window;
  }
  __name(getOwnerWindow, "getOwnerWindow");
  function getOwnerDocument(element) {
    if (!canUseDOM) {
      throw new Error("Cannot access document outside of the DOM");
    }
    return element?.ownerDocument ?? document;
  }
  __name(getOwnerDocument, "getOwnerDocument");
  function getActiveElement(node, activeDescendant = false) {
    const { activeElement } = getOwnerDocument(node);
    if (!activeElement?.nodeName) {
      return null;
    }
    if (isFrame(activeElement) && activeElement.contentDocument) {
      return getActiveElement(activeElement.contentDocument.body, activeDescendant);
    }
    if (activeDescendant) {
      const id = activeElement.getAttribute("aria-activedescendant");
      if (id) {
        const element = getOwnerDocument(activeElement).getElementById(id);
        if (element) {
          return element;
        }
      }
    }
    return activeElement;
  }
  __name(getActiveElement, "getActiveElement");
  function isFrame(element) {
    return element.tagName === "IFRAME";
  }
  __name(isFrame, "isFrame");

  // node_modules/@radix-ui/react-compose-refs/dist/index.mjs
  var React = __toESM(require_react(), 1);
  var __defProp3 = Object.defineProperty;
  var __name2 = (target, value) => __defProp3(target, "name", { value, configurable: true });
  function setRef(ref, value) {
    if (typeof ref === "function") {
      return ref(value);
    } else if (ref !== null && ref !== void 0) {
      ref.current = value;
    }
  }
  __name2(setRef, "setRef");
  function composeRefs(...refs) {
    return (node) => {
      let hasCleanup = false;
      const cleanups = refs.map((ref) => {
        const cleanup = setRef(ref, node);
        if (!hasCleanup && typeof cleanup == "function") {
          hasCleanup = true;
        }
        return cleanup;
      });
      if (hasCleanup) {
        return () => {
          for (let i = 0; i < cleanups.length; i++) {
            const cleanup = cleanups[i];
            if (typeof cleanup == "function") {
              cleanup();
            } else {
              setRef(refs[i], null);
            }
          }
        };
      }
    };
  }
  __name2(composeRefs, "composeRefs");
  function useComposedRefs(...refs) {
    return React.useCallback(composeRefs(...refs), refs);
  }
  __name2(useComposedRefs, "useComposedRefs");

  // node_modules/@radix-ui/react-context/dist/index.mjs
  var React2 = __toESM(require_react(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var __defProp4 = Object.defineProperty;
  var __name3 = (target, value) => __defProp4(target, "name", { value, configurable: true });
  // @__NO_SIDE_EFFECTS__
  function createContext22(rootComponentName, defaultContext) {
    const Context = React2.createContext(defaultContext);
    Context.displayName = rootComponentName + "Context";
    const Provider = /* @__PURE__ */ __name3((props) => {
      const { children, ...context } = props;
      const value = React2.useMemo(() => context, Object.values(context));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Context.Provider, { value, children });
    }, "Provider");
    Provider.displayName = rootComponentName + "Provider";
    function useContext22(consumerName, options = {}) {
      const { optional = false } = options;
      const context = React2.useContext(Context);
      if (context) return context;
      if (defaultContext !== void 0) return defaultContext;
      if (optional) return void 0;
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    }
    __name3(useContext22, "useContext");
    return [Provider, useContext22];
  }
  __name3(createContext22, "createContext");
  // @__NO_SIDE_EFFECTS__
  function createContextScope(scopeName, createContextScopeDeps = []) {
    let defaultContexts = [];
    function createContext32(rootComponentName, defaultContext) {
      const BaseContext = React2.createContext(defaultContext);
      BaseContext.displayName = rootComponentName + "Context";
      const index = defaultContexts.length;
      defaultContexts = [...defaultContexts, defaultContext];
      const Provider = /* @__PURE__ */ __name3((props) => {
        const { scope, children, ...context } = props;
        const Context = scope?.[scopeName]?.[index] || BaseContext;
        const value = React2.useMemo(() => context, Object.values(context));
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Context.Provider, { value, children });
      }, "Provider");
      Provider.displayName = rootComponentName + "Provider";
      function useContext22(consumerName, scope, options = {}) {
        const { optional = false } = options;
        const Context = scope?.[scopeName]?.[index] || BaseContext;
        const context = React2.useContext(Context);
        if (context) return context;
        if (defaultContext !== void 0) return defaultContext;
        if (optional) return void 0;
        throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
      }
      __name3(useContext22, "useContext");
      return [Provider, useContext22];
    }
    __name3(createContext32, "createContext");
    const createScope = /* @__PURE__ */ __name3(() => {
      const scopeContexts = defaultContexts.map((defaultContext) => {
        return React2.createContext(defaultContext);
      });
      return /* @__PURE__ */ __name3(function useScope(scope) {
        const contexts = scope?.[scopeName] || scopeContexts;
        return React2.useMemo(
          () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
          [scope, contexts]
        );
      }, "useScope");
    }, "createScope");
    createScope.scopeName = scopeName;
    return [createContext32, composeContextScopes(createScope, ...createContextScopeDeps)];
  }
  __name3(createContextScope, "createContextScope");
  function composeContextScopes(...scopes) {
    const baseScope = scopes[0];
    if (scopes.length === 1) return baseScope;
    const createScope = /* @__PURE__ */ __name3(() => {
      const scopeHooks = scopes.map((createScope2) => ({
        useScope: createScope2(),
        scopeName: createScope2.scopeName
      }));
      return /* @__PURE__ */ __name3(function useComposedScopes(overrideScopes) {
        const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
          const scopeProps = useScope(overrideScopes);
          const currentScope = scopeProps[`__scope${scopeName}`];
          return { ...nextScopes2, ...currentScope };
        }, {});
        return React2.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
      }, "useComposedScopes");
    }, "createScope");
    createScope.scopeName = baseScope.scopeName;
    return createScope;
  }
  __name3(composeContextScopes, "composeContextScopes");

  // node_modules/@radix-ui/react-id/dist/index.mjs
  var React4 = __toESM(require_react(), 1);

  // node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
  var React3 = __toESM(require_react(), 1);
  var useLayoutEffect2 = globalThis?.document ? React3.useLayoutEffect : () => {
  };

  // node_modules/@radix-ui/react-id/dist/index.mjs
  var __defProp5 = Object.defineProperty;
  var __name4 = (target, value) => __defProp5(target, "name", { value, configurable: true });
  var useReactId = React4[" useId ".trim().toString()] || (() => void 0);
  var count = 0;
  function useId(deterministicId) {
    const [id, setId] = React4.useState(useReactId());
    useLayoutEffect2(() => {
      if (!deterministicId) setId((reactId) => reactId ?? String(count++));
    }, [deterministicId]);
    return deterministicId || (id ? `radix-${id}` : "");
  }
  __name4(useId, "useId");

  // node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
  var React6 = __toESM(require_react(), 1);

  // node_modules/@radix-ui/primitive/dist/internal/is-development.false.mjs
  var IS_DEVELOPMENT = false;

  // node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
  var React22 = __toESM(require_react(), 1);

  // node_modules/@radix-ui/react-use-effect-event/dist/index.mjs
  var React5 = __toESM(require_react(), 1);
  var __defProp6 = Object.defineProperty;
  var __name5 = (target, value) => __defProp6(target, "name", { value, configurable: true });
  var useReactEffectEvent = React5[" useEffectEvent ".trim().toString()];
  var useReactInsertionEffect = React5[" useInsertionEffect ".trim().toString()];
  function useEffectEvent(callback) {
    if (typeof useReactEffectEvent === "function") {
      return useReactEffectEvent(callback);
    }
    const ref = React5.useRef(() => {
      throw new Error("Cannot call an event handler while rendering.");
    });
    if (typeof useReactInsertionEffect === "function") {
      useReactInsertionEffect(() => {
        ref.current = callback;
      });
    } else {
      useLayoutEffect2(() => {
        ref.current = callback;
      });
    }
    return React5.useMemo(() => (...args) => ref.current?.(...args), []);
  }
  __name5(useEffectEvent, "useEffectEvent");

  // node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
  var __defProp7 = Object.defineProperty;
  var __name6 = (target, value) => __defProp7(target, "name", { value, configurable: true });
  var useInsertionEffect = React6[" useInsertionEffect ".trim().toString()] || useLayoutEffect2;
  function useControllableState({
    prop,
    defaultProp,
    onChange = /* @__PURE__ */ __name6(() => {
    }, "onChange"),
    caller
  }) {
    const [uncontrolledProp, setUncontrolledProp, onChangeRef] = useUncontrolledState({
      defaultProp,
      onChange
    });
    const isControlled = prop !== void 0;
    const value = isControlled ? prop : uncontrolledProp;
    if (IS_DEVELOPMENT) {
      const isControlledRef = React6.useRef(prop !== void 0);
      React6.useEffect(() => {
        const wasControlled = isControlledRef.current;
        if (wasControlled !== isControlled) {
          const from = wasControlled ? "controlled" : "uncontrolled";
          const to = isControlled ? "controlled" : "uncontrolled";
          console.warn(
            `${caller} is changing from ${from} to ${to}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
          );
        }
        isControlledRef.current = isControlled;
      }, [isControlled, caller]);
    }
    const setValue = React6.useCallback(
      (nextValue) => {
        if (isControlled) {
          const value2 = isFunction(nextValue) ? nextValue(prop) : nextValue;
          if (value2 !== prop) {
            onChangeRef.current?.(value2);
          }
        } else {
          setUncontrolledProp(nextValue);
        }
      },
      [isControlled, prop, setUncontrolledProp, onChangeRef]
    );
    return [value, setValue];
  }
  __name6(useControllableState, "useControllableState");
  function useUncontrolledState({
    defaultProp,
    onChange
  }) {
    const [value, setValue] = React6.useState(defaultProp);
    const prevValueRef = React6.useRef(value);
    const onChangeRef = React6.useRef(onChange);
    useInsertionEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    React6.useEffect(() => {
      if (prevValueRef.current !== value) {
        onChangeRef.current?.(value);
        prevValueRef.current = value;
      }
    }, [value, prevValueRef]);
    return [value, setValue, onChangeRef];
  }
  __name6(useUncontrolledState, "useUncontrolledState");
  function isFunction(value) {
    return typeof value === "function";
  }
  __name6(isFunction, "isFunction");
  var SYNC_STATE = Symbol("RADIX:SYNC_STATE");
  function useControllableStateReducer(reducer, userArgs, initialArg, init2) {
    const { prop: controlledState, defaultProp, onChange: onChangeProp, caller } = userArgs;
    const isControlled = controlledState !== void 0;
    const onChange = useEffectEvent(onChangeProp);
    if (IS_DEVELOPMENT) {
      const isControlledRef = React22.useRef(controlledState !== void 0);
      React22.useEffect(() => {
        const wasControlled = isControlledRef.current;
        if (wasControlled !== isControlled) {
          const from = wasControlled ? "controlled" : "uncontrolled";
          const to = isControlled ? "controlled" : "uncontrolled";
          console.warn(
            `${caller} is changing from ${from} to ${to}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
          );
        }
        isControlledRef.current = isControlled;
      }, [isControlled, caller]);
    }
    const args = [{ ...initialArg, state: defaultProp }];
    if (init2) {
      args.push(init2);
    }
    const [internalState, dispatch] = React22.useReducer(
      (state2, action) => {
        if (action.type === SYNC_STATE) {
          return { ...state2, state: action.state };
        }
        const next = reducer(state2, action);
        if (isControlled && !Object.is(next.state, state2.state)) {
          onChange(next.state);
        }
        return next;
      },
      ...args
    );
    const uncontrolledState = internalState.state;
    const prevValueRef = React22.useRef(uncontrolledState);
    React22.useEffect(() => {
      if (prevValueRef.current !== uncontrolledState) {
        prevValueRef.current = uncontrolledState;
        if (!isControlled) {
          onChange(uncontrolledState);
        }
      }
    }, [uncontrolledState, prevValueRef, isControlled]);
    const state = React22.useMemo(() => {
      const isControlled2 = controlledState !== void 0;
      if (isControlled2) {
        return { ...internalState, state: controlledState };
      }
      return internalState;
    }, [internalState, controlledState]);
    React22.useEffect(() => {
      if (isControlled && !Object.is(controlledState, internalState.state)) {
        dispatch({ type: SYNC_STATE, state: controlledState });
      }
    }, [controlledState, internalState.state, isControlled]);
    return [state, dispatch];
  }
  __name6(useControllableStateReducer, "useControllableStateReducer");

  // node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var React10 = __toESM(require_react(), 1);

  // node_modules/@radix-ui/react-primitive/dist/index.mjs
  var React8 = __toESM(require_react(), 1);
  var ReactDOM = __toESM(require_react_dom(), 1);

  // node_modules/@radix-ui/react-slot/dist/index.mjs
  var React7 = __toESM(require_react(), 1);
  var __defProp8 = Object.defineProperty;
  var __name7 = (target, value) => __defProp8(target, "name", { value, configurable: true });
  // @__NO_SIDE_EFFECTS__
  function createSlot(ownerName) {
    const Slot2 = React7.forwardRef((props, forwardedRef) => {
      let { children, ...slotProps } = props;
      let slottableElement = null;
      let hasSlottable = false;
      const newChildren = [];
      if (isLazyComponent(children) && typeof use2 === "function") {
        children = use2(children._payload);
      }
      React7.Children.forEach(children, (maybeSlottable) => {
        if (isSlottable(maybeSlottable)) {
          hasSlottable = true;
          const slottable = maybeSlottable;
          let child = "child" in slottable.props ? slottable.props.child : slottable.props.children;
          if (isLazyComponent(child) && typeof use2 === "function") {
            child = use2(child._payload);
          }
          slottableElement = getSlottableElementFromSlottable(slottable, child);
          newChildren.push(slottableElement?.props?.children);
        } else {
          newChildren.push(maybeSlottable);
        }
      });
      if (slottableElement) {
        slottableElement = React7.cloneElement(slottableElement, void 0, newChildren);
      } else if (
        // A `Slottable` was found but it didn't resolve to a single element (e.g.
        // it wrapped multiple elements, text, or a render-prop `child` that
        // wasn't an element). Don't fall back to treating the `Slottable` wrapper
        // itself as the slot target — throw a descriptive error below instead.
        !hasSlottable && React7.Children.count(children) === 1 && React7.isValidElement(children)
      ) {
        slottableElement = children;
      }
      const slottableElementRef = slottableElement ? getElementRef(slottableElement) : void 0;
      const composedRef = useComposedRefs(forwardedRef, slottableElementRef);
      if (!slottableElement) {
        if (children || children === 0) {
          throw new Error(
            hasSlottable ? createSlottableError(ownerName) : createSlotError(ownerName)
          );
        }
        return children;
      }
      const mergedProps = mergeProps(slotProps, slottableElement.props ?? {});
      if (slottableElement.type !== React7.Fragment) {
        mergedProps.ref = forwardedRef ? composedRef : slottableElementRef;
      }
      return React7.cloneElement(slottableElement, mergedProps);
    });
    Slot2.displayName = `${ownerName}.Slot`;
    return Slot2;
  }
  __name7(createSlot, "createSlot");
  var SLOTTABLE_IDENTIFIER = Symbol.for("radix.slottable");
  // @__NO_SIDE_EFFECTS__
  function createSlottable(ownerName) {
    const Slottable2 = /* @__PURE__ */ __name7((props) => "child" in props ? props.children(props.child) : props.children, "Slottable");
    Slottable2.displayName = `${ownerName}.Slottable`;
    Slottable2.__radixId = SLOTTABLE_IDENTIFIER;
    return Slottable2;
  }
  __name7(createSlottable, "createSlottable");
  var getSlottableElementFromSlottable = /* @__PURE__ */ __name7((slottable, child) => {
    if ("child" in slottable.props) {
      const child2 = slottable.props.child;
      if (!React7.isValidElement(child2)) return null;
      return React7.cloneElement(child2, void 0, slottable.props.children(child2.props.children));
    }
    return React7.isValidElement(child) ? child : null;
  }, "getSlottableElementFromSlottable");
  function mergeProps(slotProps, childProps) {
    const overrideProps = { ...childProps };
    for (const propName in childProps) {
      const slotPropValue = slotProps[propName];
      const childPropValue = childProps[propName];
      const isHandler = /^on[A-Z]/.test(propName);
      if (isHandler) {
        if (slotPropValue && childPropValue) {
          overrideProps[propName] = (...args) => {
            const result = childPropValue(...args);
            slotPropValue(...args);
            return result;
          };
        } else if (slotPropValue) {
          overrideProps[propName] = slotPropValue;
        }
      } else if (propName === "style") {
        overrideProps[propName] = { ...slotPropValue, ...childPropValue };
      } else if (propName === "className") {
        overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
      }
    }
    return { ...slotProps, ...overrideProps };
  }
  __name7(mergeProps, "mergeProps");
  function getElementRef(element) {
    let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }
  __name7(getElementRef, "getElementRef");
  function isSlottable(child) {
    return React7.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER;
  }
  __name7(isSlottable, "isSlottable");
  var REACT_LAZY_TYPE = Symbol.for("react.lazy");
  function isLazyComponent(element) {
    return element != null && typeof element === "object" && "$$typeof" in element && element.$$typeof === REACT_LAZY_TYPE && "_payload" in element && isPromiseLike(element._payload);
  }
  __name7(isLazyComponent, "isLazyComponent");
  function isPromiseLike(value) {
    return typeof value === "object" && value !== null && "then" in value;
  }
  __name7(isPromiseLike, "isPromiseLike");
  var createSlotError = /* @__PURE__ */ __name7((ownerName) => {
    return `${ownerName} failed to slot onto its children. Expected a single React element child or \`Slottable\`.`;
  }, "createSlotError");
  var createSlottableError = /* @__PURE__ */ __name7((ownerName) => {
    return `${ownerName} failed to slot onto its \`Slottable\`. Expected \`Slottable\` to receive a single React element child.`;
  }, "createSlottableError");
  var use2 = React7[" use ".trim().toString()];

  // node_modules/@radix-ui/react-primitive/dist/index.mjs
  var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
  var __defProp9 = Object.defineProperty;
  var __name8 = (target, value) => __defProp9(target, "name", { value, configurable: true });
  var NODES = [
    "a",
    "button",
    "div",
    "form",
    "h2",
    "h3",
    "img",
    "input",
    "label",
    "li",
    "nav",
    "ol",
    "p",
    "select",
    "span",
    "svg",
    "ul"
  ];
  var Primitive = NODES.reduce((primitive, node) => {
    const Slot2 = createSlot(`Primitive.${node}`);
    const Node2 = React8.forwardRef((props, forwardedRef) => {
      const { asChild, ...primitiveProps } = props;
      const Comp = asChild ? Slot2 : node;
      if (typeof window !== "undefined") {
        window[Symbol.for("radix-ui")] = true;
      }
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Comp, { ...primitiveProps, ref: forwardedRef });
    });
    Node2.displayName = `Primitive.${node}`;
    return { ...primitive, [node]: Node2 };
  }, {});
  function dispatchDiscreteCustomEvent(target, event) {
    if (target) ReactDOM.flushSync(() => target.dispatchEvent(event));
  }
  __name8(dispatchDiscreteCustomEvent, "dispatchDiscreteCustomEvent");

  // node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
  var React9 = __toESM(require_react(), 1);
  var __defProp10 = Object.defineProperty;
  var __name9 = (target, value) => __defProp10(target, "name", { value, configurable: true });
  function useCallbackRef(callback) {
    const callbackRef = React9.useRef(callback);
    React9.useEffect(() => {
      callbackRef.current = callback;
    });
    return React9.useMemo(() => (...args) => callbackRef.current?.(...args), []);
  }
  __name9(useCallbackRef, "useCallbackRef");

  // node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
  var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
  var __defProp11 = Object.defineProperty;
  var __name10 = (target, value) => __defProp11(target, "name", { value, configurable: true });
  var CONTEXT_UPDATE = "dismissableLayer.update";
  var POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
  var FOCUS_OUTSIDE = "dismissableLayer.focusOutside";
  var originalBodyPointerEvents;
  var DismissableLayerContext = React10.createContext({
    layers: /* @__PURE__ */ new Set(),
    layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
    branches: /* @__PURE__ */ new Set(),
    // Outside elements that belong to a layer's own dismiss affordance (eg, a
    // dialog overlay). Pressing them should dismiss the layer regardless of
    // whether or not they stop propagation.
    //
    // See https://github.com/radix-ui/primitives/issues/3346
    dismissableSurfaces: /* @__PURE__ */ new Set()
  });
  var DismissableLayer = /* @__PURE__ */ React10.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name10(function DismissableLayer2(props, forwardedRef) {
      const {
        disableOutsidePointerEvents = false,
        deferPointerDownOutside = false,
        onEscapeKeyDown,
        onPointerDownOutside,
        onFocusOutside,
        onInteractOutside,
        onDismiss,
        ...layerProps
      } = props;
      const context = React10.useContext(DismissableLayerContext);
      const [node, setNode] = React10.useState(null);
      const ownerDocument = node?.ownerDocument ?? globalThis?.document;
      const [, force] = React10.useState({});
      const composedRefs = useComposedRefs(forwardedRef, setNode);
      const layers = Array.from(context.layers);
      const [highestLayerWithOutsidePointerEventsDisabled] = [
        ...context.layersWithOutsidePointerEventsDisabled
      ].slice(-1);
      const highestLayerWithOutsidePointerEventsDisabledIndex = highestLayerWithOutsidePointerEventsDisabled ? layers.indexOf(highestLayerWithOutsidePointerEventsDisabled) : -1;
      const index = node ? layers.indexOf(node) : -1;
      const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
      const isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex;
      const isDeferredPointerDownOutsideRef = React10.useRef(false);
      const pointerDownOutside = usePointerDownOutside(
        (event) => {
          onPointerDownOutside?.(event);
          onInteractOutside?.(event);
          if (!event.defaultPrevented) onDismiss?.();
        },
        {
          ownerDocument,
          deferPointerDownOutside,
          isDeferredPointerDownOutsideRef,
          dismissableSurfaces: context.dismissableSurfaces,
          shouldHandlePointerDownOutside: React10.useCallback(
            (target) => {
              if (!(target instanceof Node)) {
                return false;
              }
              const isPointerDownOnBranch = [...context.branches].some(
                (branch) => branch.contains(target)
              );
              return isPointerEventsEnabled && !isPointerDownOnBranch;
            },
            [context.branches, isPointerEventsEnabled]
          )
        }
      );
      const focusOutside = useFocusOutside((event) => {
        if (deferPointerDownOutside && isDeferredPointerDownOutsideRef.current) {
          return;
        }
        const target = event.target;
        const isFocusInBranch = [...context.branches].some((branch) => branch.contains(target));
        if (isFocusInBranch) return;
        onFocusOutside?.(event);
        onInteractOutside?.(event);
        if (!event.defaultPrevented) onDismiss?.();
      }, ownerDocument);
      const isHighestLayer = node ? index === layers.length - 1 : false;
      const handleKeyDown = useCallbackRef((event) => {
        if (event.key !== "Escape") {
          return;
        }
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented && onDismiss) {
          event.preventDefault();
          onDismiss();
        }
      });
      React10.useEffect(() => {
        if (!isHighestLayer) {
          return;
        }
        ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
      }, [ownerDocument, isHighestLayer, handleKeyDown]);
      React10.useEffect(() => {
        if (!node) return;
        if (disableOutsidePointerEvents) {
          if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
            originalBodyPointerEvents = ownerDocument.body.style.pointerEvents;
            ownerDocument.body.style.pointerEvents = "none";
          }
          context.layersWithOutsidePointerEventsDisabled.add(node);
        }
        context.layers.add(node);
        dispatchUpdate();
        return () => {
          if (disableOutsidePointerEvents) {
            context.layersWithOutsidePointerEventsDisabled.delete(node);
            if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
              ownerDocument.body.style.pointerEvents = originalBodyPointerEvents;
            }
          }
        };
      }, [node, ownerDocument, disableOutsidePointerEvents, context]);
      React10.useEffect(() => {
        return () => {
          if (!node) return;
          context.layers.delete(node);
          context.layersWithOutsidePointerEventsDisabled.delete(node);
          dispatchUpdate();
        };
      }, [node, context]);
      React10.useEffect(() => {
        const handleUpdate = /* @__PURE__ */ __name10(() => force({}), "handleUpdate");
        document.addEventListener(CONTEXT_UPDATE, handleUpdate);
        return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
      }, []);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        Primitive.div,
        {
          ...layerProps,
          ref: composedRefs,
          style: {
            pointerEvents: isBodyPointerEventsDisabled ? isPointerEventsEnabled ? "auto" : "none" : void 0,
            ...props.style
          },
          onFocusCapture: composeEventHandlers(props.onFocusCapture, focusOutside.onFocusCapture),
          onBlurCapture: composeEventHandlers(props.onBlurCapture, focusOutside.onBlurCapture),
          onPointerDownCapture: composeEventHandlers(
            props.onPointerDownCapture,
            pointerDownOutside.onPointerDownCapture
          )
        }
      );
    }, "DismissableLayer")
  );
  function useDismissableLayerSurface() {
    const context = React10.useContext(DismissableLayerContext);
    const [node, setNode] = React10.useState(null);
    React10.useEffect(() => {
      if (!node) {
        return;
      }
      context.dismissableSurfaces.add(node);
      return () => {
        context.dismissableSurfaces.delete(node);
      };
    }, [node, context.dismissableSurfaces]);
    return setNode;
  }
  __name10(useDismissableLayerSurface, "useDismissableLayerSurface");
  var IS_TRUE = /* @__PURE__ */ __name10(() => true, "IS_TRUE");
  function usePointerDownOutside(onPointerDownOutside, args) {
    const {
      ownerDocument = globalThis?.document,
      deferPointerDownOutside = false,
      isDeferredPointerDownOutsideRef,
      dismissableSurfaces,
      shouldHandlePointerDownOutside = IS_TRUE
    } = args;
    const handlePointerDownOutside = useCallbackRef(onPointerDownOutside);
    const isPointerInsideReactTreeRef = React10.useRef(false);
    const isPointerDownOutsideRef = React10.useRef(false);
    const interceptedOutsideInteractionEventsRef = React10.useRef(/* @__PURE__ */ new Map());
    const handleClickRef = React10.useRef(() => {
    });
    React10.useEffect(() => {
      function resetOutsideInteraction() {
        isPointerDownOutsideRef.current = false;
        isDeferredPointerDownOutsideRef.current = false;
        interceptedOutsideInteractionEventsRef.current.clear();
      }
      __name10(resetOutsideInteraction, "resetOutsideInteraction");
      function isOutsideInteractionIntercepted() {
        return Array.from(interceptedOutsideInteractionEventsRef.current.values()).some(Boolean);
      }
      __name10(isOutsideInteractionIntercepted, "isOutsideInteractionIntercepted");
      function handleInteractionCapture(event) {
        if (!isPointerDownOutsideRef.current) {
          return;
        }
        const target = event.target;
        const isDismissableSurface = target instanceof Node && [...dismissableSurfaces].some((surface) => surface.contains(target));
        if (!isDismissableSurface) {
          interceptedOutsideInteractionEventsRef.current.set(event.type, true);
        }
        if (event.type === "click") {
          window.setTimeout(() => {
            if (isPointerDownOutsideRef.current) {
              handleClickRef.current();
            }
          }, 0);
        }
      }
      __name10(handleInteractionCapture, "handleInteractionCapture");
      function handleInteractionBubble(event) {
        if (isPointerDownOutsideRef.current) {
          interceptedOutsideInteractionEventsRef.current.set(event.type, false);
        }
      }
      __name10(handleInteractionBubble, "handleInteractionBubble");
      const handlePointerDown = /* @__PURE__ */ __name10((event) => {
        if (event.target && !isPointerInsideReactTreeRef.current) {
          let handleAndDispatchPointerDownOutsideEvent2 = function() {
            ownerDocument.removeEventListener("click", handleClickRef.current);
            const wasOutsideInteractionIntercepted = isOutsideInteractionIntercepted();
            resetOutsideInteraction();
            if (!wasOutsideInteractionIntercepted) {
              handleAndDispatchCustomEvent(
                POINTER_DOWN_OUTSIDE,
                handlePointerDownOutside,
                eventDetail,
                { discrete: true }
              );
            }
          };
          var handleAndDispatchPointerDownOutsideEvent = handleAndDispatchPointerDownOutsideEvent2;
          __name10(handleAndDispatchPointerDownOutsideEvent2, "handleAndDispatchPointerDownOutsideEvent");
          if (!shouldHandlePointerDownOutside(event.target)) {
            ownerDocument.removeEventListener("click", handleClickRef.current);
            resetOutsideInteraction();
            isPointerInsideReactTreeRef.current = false;
            return;
          }
          const eventDetail = { originalEvent: event };
          isPointerDownOutsideRef.current = true;
          isDeferredPointerDownOutsideRef.current = deferPointerDownOutside && event.button === 0;
          interceptedOutsideInteractionEventsRef.current.clear();
          if (!deferPointerDownOutside || event.button !== 0) {
            handleAndDispatchPointerDownOutsideEvent2();
          } else {
            ownerDocument.removeEventListener("click", handleClickRef.current);
            handleClickRef.current = handleAndDispatchPointerDownOutsideEvent2;
            ownerDocument.addEventListener("click", handleClickRef.current, { once: true });
          }
        } else {
          ownerDocument.removeEventListener("click", handleClickRef.current);
          resetOutsideInteraction();
        }
        isPointerInsideReactTreeRef.current = false;
      }, "handlePointerDown");
      const outsideInteractionEvents = [
        "pointerup",
        "mousedown",
        "mouseup",
        "touchstart",
        "touchend",
        "click"
      ];
      for (const eventName of outsideInteractionEvents) {
        ownerDocument.addEventListener(eventName, handleInteractionCapture, true);
        ownerDocument.addEventListener(eventName, handleInteractionBubble);
      }
      const timerId = window.setTimeout(() => {
        ownerDocument.addEventListener("pointerdown", handlePointerDown);
      }, 0);
      return () => {
        window.clearTimeout(timerId);
        ownerDocument.removeEventListener("pointerdown", handlePointerDown);
        ownerDocument.removeEventListener("click", handleClickRef.current);
        for (const eventName of outsideInteractionEvents) {
          ownerDocument.removeEventListener(eventName, handleInteractionCapture, true);
          ownerDocument.removeEventListener(eventName, handleInteractionBubble);
        }
      };
    }, [
      ownerDocument,
      handlePointerDownOutside,
      deferPointerDownOutside,
      isDeferredPointerDownOutsideRef,
      dismissableSurfaces,
      shouldHandlePointerDownOutside
    ]);
    return {
      // ensures we check React component tree (not just DOM tree)
      onPointerDownCapture: /* @__PURE__ */ __name10(() => isPointerInsideReactTreeRef.current = true, "onPointerDownCapture")
    };
  }
  __name10(usePointerDownOutside, "usePointerDownOutside");
  function useFocusOutside(onFocusOutside, ownerDocument = globalThis?.document) {
    const handleFocusOutside = useCallbackRef(onFocusOutside);
    const isFocusInsideReactTreeRef = React10.useRef(false);
    React10.useEffect(() => {
      const handleFocus = /* @__PURE__ */ __name10((event) => {
        if (event.target && !isFocusInsideReactTreeRef.current) {
          const eventDetail = { originalEvent: event };
          handleAndDispatchCustomEvent(FOCUS_OUTSIDE, handleFocusOutside, eventDetail, {
            discrete: false
          });
        }
      }, "handleFocus");
      ownerDocument.addEventListener("focusin", handleFocus);
      return () => ownerDocument.removeEventListener("focusin", handleFocus);
    }, [ownerDocument, handleFocusOutside]);
    return {
      onFocusCapture: /* @__PURE__ */ __name10(() => isFocusInsideReactTreeRef.current = true, "onFocusCapture"),
      onBlurCapture: /* @__PURE__ */ __name10(() => isFocusInsideReactTreeRef.current = false, "onBlurCapture")
    };
  }
  __name10(useFocusOutside, "useFocusOutside");
  function dispatchUpdate() {
    const event = new CustomEvent(CONTEXT_UPDATE);
    document.dispatchEvent(event);
  }
  __name10(dispatchUpdate, "dispatchUpdate");
  function handleAndDispatchCustomEvent(name, handler, detail2, { discrete }) {
    const target = detail2.originalEvent.target;
    const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail: detail2 });
    if (handler) target.addEventListener(name, handler, { once: true });
    if (discrete) {
      dispatchDiscreteCustomEvent(target, event);
    } else {
      target.dispatchEvent(event);
    }
  }
  __name10(handleAndDispatchCustomEvent, "handleAndDispatchCustomEvent");

  // node_modules/@radix-ui/react-focus-scope/dist/index.mjs
  var React11 = __toESM(require_react(), 1);
  var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
  var __defProp12 = Object.defineProperty;
  var __name11 = (target, value) => __defProp12(target, "name", { value, configurable: true });
  var AUTOFOCUS_ON_MOUNT = "focusScope.autoFocusOnMount";
  var AUTOFOCUS_ON_UNMOUNT = "focusScope.autoFocusOnUnmount";
  var EVENT_OPTIONS = { bubbles: false, cancelable: true };
  var FocusScope = /* @__PURE__ */ React11.forwardRef(
    /* @__PURE__ */ __name11(function FocusScope2(props, forwardedRef) {
      const {
        loop = false,
        trapped = false,
        onMountAutoFocus: onMountAutoFocusProp,
        onUnmountAutoFocus: onUnmountAutoFocusProp,
        ...scopeProps
      } = props;
      const [container, setContainer] = React11.useState(null);
      const onMountAutoFocus = useCallbackRef(onMountAutoFocusProp);
      const onUnmountAutoFocus = useCallbackRef(onUnmountAutoFocusProp);
      const lastFocusedElementRef = React11.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, setContainer);
      const focusScope = React11.useRef({
        paused: false,
        pause() {
          this.paused = true;
        },
        resume() {
          this.paused = false;
        }
      }).current;
      React11.useEffect(() => {
        if (trapped) {
          let handleFocusIn2 = function(event) {
            if (focusScope.paused || !container) return;
            const target = event.target;
            if (container.contains(target)) {
              lastFocusedElementRef.current = target;
            } else {
              focus(lastFocusedElementRef.current, { select: true });
            }
          }, handleFocusOut2 = function(event) {
            if (focusScope.paused || !container) return;
            const relatedTarget = event.relatedTarget;
            if (relatedTarget === null) return;
            if (!container.contains(relatedTarget)) {
              focus(lastFocusedElementRef.current, { select: true });
            }
          }, handleMutations2 = function(mutations) {
            const focusedElement = document.activeElement;
            if (focusedElement !== document.body) return;
            for (const mutation of mutations) {
              if (mutation.removedNodes.length > 0) focus(container);
            }
          };
          var handleFocusIn = handleFocusIn2, handleFocusOut = handleFocusOut2, handleMutations = handleMutations2;
          __name11(handleFocusIn2, "handleFocusIn");
          __name11(handleFocusOut2, "handleFocusOut");
          __name11(handleMutations2, "handleMutations");
          document.addEventListener("focusin", handleFocusIn2);
          document.addEventListener("focusout", handleFocusOut2);
          const mutationObserver = new MutationObserver(handleMutations2);
          if (container) mutationObserver.observe(container, { childList: true, subtree: true });
          return () => {
            document.removeEventListener("focusin", handleFocusIn2);
            document.removeEventListener("focusout", handleFocusOut2);
            mutationObserver.disconnect();
          };
        }
      }, [trapped, container, focusScope.paused]);
      React11.useEffect(() => {
        if (container) {
          focusScopesStack.add(focusScope);
          const previouslyFocusedElement = document.activeElement;
          const hasFocusedCandidate = container.contains(previouslyFocusedElement);
          if (!hasFocusedCandidate) {
            const mountEvent = new CustomEvent(AUTOFOCUS_ON_MOUNT, EVENT_OPTIONS);
            container.addEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
            container.dispatchEvent(mountEvent);
            if (!mountEvent.defaultPrevented) {
              focusFirst(removeLinks(getTabbableCandidates(container)), { select: true });
              if (document.activeElement === previouslyFocusedElement) {
                focus(container);
              }
            }
          }
          return () => {
            container.removeEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus);
            setTimeout(() => {
              const unmountEvent = new CustomEvent(AUTOFOCUS_ON_UNMOUNT, EVENT_OPTIONS);
              container.addEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
              container.dispatchEvent(unmountEvent);
              if (!unmountEvent.defaultPrevented) {
                focus(previouslyFocusedElement ?? document.body, { select: true });
              }
              container.removeEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus);
              focusScopesStack.remove(focusScope);
            }, 0);
          };
        }
      }, [container, onMountAutoFocus, onUnmountAutoFocus, focusScope]);
      const handleKeyDown = React11.useCallback(
        (event) => {
          if (!loop && !trapped) return;
          if (focusScope.paused) return;
          const isTabKey = event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
          const focusedElement = document.activeElement;
          if (isTabKey && focusedElement) {
            const container2 = event.currentTarget;
            const [first, last] = getTabbableEdges(container2);
            const hasTabbableElementsInside = first && last;
            if (!hasTabbableElementsInside) {
              if (focusedElement === container2) event.preventDefault();
            } else {
              if (!event.shiftKey && focusedElement === last) {
                event.preventDefault();
                if (loop) focus(first, { select: true });
              } else if (event.shiftKey && focusedElement === first) {
                event.preventDefault();
                if (loop) focus(last, { select: true });
              }
            }
          }
        },
        [loop, trapped, focusScope.paused]
      );
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Primitive.div, { tabIndex: -1, ...scopeProps, ref: composedRefs, onKeyDown: handleKeyDown });
    }, "FocusScope")
  );
  function focusFirst(candidates, { select = false } = {}) {
    const previouslyFocusedElement = document.activeElement;
    for (const candidate of candidates) {
      focus(candidate, { select });
      if (document.activeElement !== previouslyFocusedElement) return;
    }
  }
  __name11(focusFirst, "focusFirst");
  function getTabbableEdges(container) {
    const candidates = getTabbableCandidates(container);
    const first = findVisible(candidates, container);
    const last = findVisible(candidates.reverse(), container);
    return [first, last];
  }
  __name11(getTabbableEdges, "getTabbableEdges");
  function getTabbableCandidates(container) {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode: /* @__PURE__ */ __name11((node) => {
        const isHiddenInput = node.tagName === "INPUT" && node.type === "hidden";
        if (node.disabled || node.hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
        return node.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }, "acceptNode")
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  __name11(getTabbableCandidates, "getTabbableCandidates");
  function findVisible(elements, container) {
    const canUseCheckVisibility = typeof container.checkVisibility === "function" && container.checkVisibility({ checkVisibilityCSS: true });
    for (const element of elements) {
      const hidden = canUseCheckVisibility ? !element.checkVisibility({ checkVisibilityCSS: true }) : isHidden(element, { upTo: container });
      if (!hidden) {
        return element;
      }
    }
  }
  __name11(findVisible, "findVisible");
  function isHidden(node, { upTo }) {
    if (getComputedStyle(node).visibility === "hidden") return true;
    while (node) {
      if (upTo !== void 0 && node === upTo) return false;
      if (getComputedStyle(node).display === "none") return true;
      node = node.parentElement;
    }
    return false;
  }
  __name11(isHidden, "isHidden");
  function isSelectableInput(element) {
    return element instanceof HTMLInputElement && "select" in element;
  }
  __name11(isSelectableInput, "isSelectableInput");
  function focus(element, { select = false } = {}) {
    if (element && element.focus) {
      const previouslyFocusedElement = document.activeElement;
      element.focus({ preventScroll: true });
      if (element !== previouslyFocusedElement && isSelectableInput(element) && select)
        element.select();
    }
  }
  __name11(focus, "focus");
  var focusScopesStack = createFocusScopesStack();
  function createFocusScopesStack() {
    let stack = [];
    return {
      add(focusScope) {
        const activeFocusScope = stack[0];
        if (focusScope !== activeFocusScope) {
          activeFocusScope?.pause();
        }
        stack = arrayRemove(stack, focusScope);
        stack.unshift(focusScope);
      },
      remove(focusScope) {
        stack = arrayRemove(stack, focusScope);
        stack[0]?.resume();
      }
    };
  }
  __name11(createFocusScopesStack, "createFocusScopesStack");
  function arrayRemove(array, item) {
    const updatedArray = [...array];
    const index = updatedArray.indexOf(item);
    if (index !== -1) {
      updatedArray.splice(index, 1);
    }
    return updatedArray;
  }
  __name11(arrayRemove, "arrayRemove");
  function removeLinks(items) {
    return items.filter((item) => item.tagName !== "A");
  }
  __name11(removeLinks, "removeLinks");

  // node_modules/@radix-ui/react-portal/dist/index.mjs
  var React12 = __toESM(require_react(), 1);
  var ReactDOM2 = __toESM(require_react_dom(), 1);
  var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
  var __defProp13 = Object.defineProperty;
  var __name12 = (target, value) => __defProp13(target, "name", { value, configurable: true });
  var Portal = /* @__PURE__ */ React12.forwardRef(
    /* @__PURE__ */ __name12(function Portal2(props, forwardedRef) {
      const { container: containerProp, ...portalProps } = props;
      const [mounted, setMounted] = React12.useState(false);
      useLayoutEffect2(() => setMounted(true), []);
      const container = containerProp || mounted && globalThis?.document?.body;
      return container ? ReactDOM2.createPortal(/* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Primitive.div, { ...portalProps, ref: forwardedRef }), container) : null;
    }, "Portal")
  );

  // node_modules/@radix-ui/react-presence/dist/index.mjs
  var React23 = __toESM(require_react(), 1);
  var React13 = __toESM(require_react(), 1);
  var __defProp14 = Object.defineProperty;
  var __name13 = (target, value) => __defProp14(target, "name", { value, configurable: true });
  function useStateMachine(initialState, machine) {
    return React13.useReducer((state, event) => {
      const nextState = machine[state][event];
      return nextState ?? state;
    }, initialState);
  }
  __name13(useStateMachine, "useStateMachine");
  var Presence = /* @__PURE__ */ __name13((props) => {
    const { present, children } = props;
    const presence = usePresence(present);
    const child = typeof children === "function" ? children({ present: presence.isPresent }) : React23.Children.only(children);
    const ref = useStableComposedRefs(presence.ref, getElementRef2(child));
    const forceMount = typeof children === "function";
    return forceMount || presence.isPresent ? React23.cloneElement(child, { ref }) : null;
  }, "Presence");
  function usePresence(present) {
    const [node, setNode] = React23.useState();
    const stylesRef = React23.useRef(null);
    const prevPresentRef = React23.useRef(present);
    const prevAnimationNameRef = React23.useRef("none");
    const mountAnimationNameRef = React23.useRef(void 0);
    const initialState = present ? "mounted" : "unmounted";
    const [state, send] = useStateMachine(initialState, {
      mounted: {
        UNMOUNT: "unmounted",
        ANIMATION_OUT: "unmountSuspended"
      },
      unmountSuspended: {
        MOUNT: "mounted",
        ANIMATION_END: "unmounted"
      },
      unmounted: {
        MOUNT: "mounted"
      }
    });
    React23.useEffect(() => {
      if (state === "mounted") {
        prevAnimationNameRef.current = mountAnimationNameRef.current ?? getAnimationName(stylesRef.current);
        mountAnimationNameRef.current = void 0;
      } else {
        prevAnimationNameRef.current = "none";
      }
    }, [state]);
    useLayoutEffect2(() => {
      const styles = stylesRef.current;
      const wasPresent = prevPresentRef.current;
      const hasPresentChanged = wasPresent !== present;
      if (hasPresentChanged) {
        const prevAnimationName = prevAnimationNameRef.current;
        const currentAnimationName = getAnimationName(styles);
        if (present) {
          mountAnimationNameRef.current = currentAnimationName;
          send("MOUNT");
        } else if (currentAnimationName === "none" || styles?.display === "none") {
          send("UNMOUNT");
        } else {
          const isAnimating = prevAnimationName !== currentAnimationName;
          if (wasPresent && isAnimating) {
            send("ANIMATION_OUT");
          } else {
            send("UNMOUNT");
          }
        }
        prevPresentRef.current = present;
      }
    }, [present, send]);
    useLayoutEffect2(() => {
      if (node) {
        let timeoutId;
        const ownerWindow = node.ownerDocument.defaultView ?? window;
        const handleAnimationEnd = /* @__PURE__ */ __name13((event) => {
          const currentAnimationName = getAnimationName(stylesRef.current);
          const isCurrentAnimation = currentAnimationName.includes(CSS.escape(event.animationName));
          if (event.target === node && isCurrentAnimation) {
            send("ANIMATION_END");
            if (!prevPresentRef.current) {
              const currentFillMode = node.style.animationFillMode;
              node.style.animationFillMode = "forwards";
              timeoutId = ownerWindow.setTimeout(() => {
                if (node.style.animationFillMode === "forwards") {
                  node.style.animationFillMode = currentFillMode;
                }
              });
            }
          }
        }, "handleAnimationEnd");
        const handleAnimationStart = /* @__PURE__ */ __name13((event) => {
          if (event.target === node) {
            prevAnimationNameRef.current = getAnimationName(stylesRef.current);
          }
        }, "handleAnimationStart");
        node.addEventListener("animationstart", handleAnimationStart);
        node.addEventListener("animationcancel", handleAnimationEnd);
        node.addEventListener("animationend", handleAnimationEnd);
        return () => {
          ownerWindow.clearTimeout(timeoutId);
          node.removeEventListener("animationstart", handleAnimationStart);
          node.removeEventListener("animationcancel", handleAnimationEnd);
          node.removeEventListener("animationend", handleAnimationEnd);
        };
      } else {
        send("ANIMATION_END");
      }
    }, [node, send]);
    return {
      isPresent: ["mounted", "unmountSuspended"].includes(state),
      ref: React23.useCallback((node2) => {
        if (node2) {
          const styles = getComputedStyle(node2);
          stylesRef.current = styles;
          mountAnimationNameRef.current = getAnimationName(styles);
        } else {
          stylesRef.current = null;
        }
        setNode(node2);
      }, [])
    };
  }
  __name13(usePresence, "usePresence");
  function setRef2(ref, value) {
    if (typeof ref === "function") {
      return ref(value);
    } else if (ref !== null && ref !== void 0) {
      ref.current = value;
    }
  }
  __name13(setRef2, "setRef");
  function useStableComposedRefs(...refs) {
    const refsRef = React23.useRef(refs);
    refsRef.current = refs;
    return React23.useCallback((node) => {
      const currentRefs = refsRef.current;
      let hasCleanup = false;
      const cleanups = currentRefs.map((ref) => {
        const cleanup = setRef2(ref, node);
        if (!hasCleanup && typeof cleanup === "function") {
          hasCleanup = true;
        }
        return cleanup;
      });
      if (hasCleanup) {
        return () => {
          for (let i = 0; i < cleanups.length; i++) {
            const cleanup = cleanups[i];
            if (typeof cleanup === "function") {
              cleanup();
            } else {
              setRef2(currentRefs[i], null);
            }
          }
        };
      }
    }, []);
  }
  __name13(useStableComposedRefs, "useStableComposedRefs");
  function getAnimationName(styles) {
    return styles?.animationName || "none";
  }
  __name13(getAnimationName, "getAnimationName");
  function getElementRef2(element) {
    let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
    let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
    if (mayWarn) {
      return element.ref;
    }
    getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
    mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
    if (mayWarn) {
      return element.props.ref;
    }
    return element.props.ref || element.ref;
  }
  __name13(getElementRef2, "getElementRef");

  // node_modules/@radix-ui/react-focus-guards/dist/index.mjs
  var React14 = __toESM(require_react(), 1);
  var __defProp15 = Object.defineProperty;
  var __name14 = (target, value) => __defProp15(target, "name", { value, configurable: true });
  var count2 = 0;
  var guards = null;
  function FocusGuards(props) {
    useFocusGuards();
    return props.children;
  }
  __name14(FocusGuards, "FocusGuards");
  function useFocusGuards() {
    React14.useEffect(() => {
      if (!guards) {
        guards = { start: createFocusGuard(), end: createFocusGuard() };
      }
      const { start, end } = guards;
      if (document.body.firstElementChild !== start) {
        document.body.insertAdjacentElement("afterbegin", start);
      }
      if (document.body.lastElementChild !== end) {
        document.body.insertAdjacentElement("beforeend", end);
      }
      count2++;
      return () => {
        if (count2 === 1) {
          guards?.start.remove();
          guards?.end.remove();
          guards = null;
        }
        count2 = Math.max(0, count2 - 1);
      };
    }, []);
  }
  __name14(useFocusGuards, "useFocusGuards");
  function createFocusGuard() {
    const element = document.createElement("span");
    element.setAttribute("data-radix-focus-guard", "");
    element.tabIndex = 0;
    element.style.outline = "none";
    element.style.opacity = "0";
    element.style.position = "fixed";
    element.style.pointerEvents = "none";
    return element;
  }
  __name14(createFocusGuard, "createFocusGuard");

  // node_modules/tslib/tslib.es6.mjs
  var __assign = function() {
    __assign = Object.assign || function __assign2(t3) {
      for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t3[p] = s[p];
      }
      return t3;
    };
    return __assign.apply(this, arguments);
  };
  function __rest(s, e) {
    var t3 = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
      t3[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
          t3[p[i]] = s[p[i]];
      }
    return t3;
  }
  function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
      if (ar || !(i in from)) {
        if (!ar) ar = Array.prototype.slice.call(from, 0, i);
        ar[i] = from[i];
      }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
  }

  // node_modules/react-remove-scroll/dist/es2015/Combination.js
  var React21 = __toESM(require_react());

  // node_modules/react-remove-scroll/dist/es2015/UI.js
  var React17 = __toESM(require_react());

  // node_modules/react-remove-scroll-bar/dist/es2015/constants.js
  var zeroRightClassName = "right-scroll-bar-position";
  var fullWidthClassName = "width-before-scroll-bar";
  var noScrollbarsClassName = "with-scroll-bars-hidden";
  var removedBarSizeVariable = "--removed-body-scroll-bar-size";

  // node_modules/use-callback-ref/dist/es2015/assignRef.js
  function assignRef(ref, value) {
    if (typeof ref === "function") {
      ref(value);
    } else if (ref) {
      ref.current = value;
    }
    return ref;
  }

  // node_modules/use-callback-ref/dist/es2015/useRef.js
  var import_react9 = __toESM(require_react());
  function useCallbackRef2(initialValue, callback) {
    var ref = (0, import_react9.useState)(function() {
      return {
        // value
        value: initialValue,
        // last callback
        callback,
        // "memoized" public interface
        facade: {
          get current() {
            return ref.value;
          },
          set current(value) {
            var last = ref.value;
            if (last !== value) {
              ref.value = value;
              ref.callback(value, last);
            }
          }
        }
      };
    })[0];
    ref.callback = callback;
    return ref.facade;
  }

  // node_modules/use-callback-ref/dist/es2015/useMergeRef.js
  var React15 = __toESM(require_react());
  var useIsomorphicLayoutEffect = typeof window !== "undefined" ? React15.useLayoutEffect : React15.useEffect;
  var currentValues = /* @__PURE__ */ new WeakMap();
  function useMergeRefs(refs, defaultValue) {
    var callbackRef = useCallbackRef2(defaultValue || null, function(newValue) {
      return refs.forEach(function(ref) {
        return assignRef(ref, newValue);
      });
    });
    useIsomorphicLayoutEffect(function() {
      var oldValue = currentValues.get(callbackRef);
      if (oldValue) {
        var prevRefs_1 = new Set(oldValue);
        var nextRefs_1 = new Set(refs);
        var current_1 = callbackRef.current;
        prevRefs_1.forEach(function(ref) {
          if (!nextRefs_1.has(ref)) {
            assignRef(ref, null);
          }
        });
        nextRefs_1.forEach(function(ref) {
          if (!prevRefs_1.has(ref)) {
            assignRef(ref, current_1);
          }
        });
      }
      currentValues.set(callbackRef, refs);
    }, [refs]);
    return callbackRef;
  }

  // node_modules/use-sidecar/dist/es2015/medium.js
  function ItoI(a) {
    return a;
  }
  function innerCreateMedium(defaults, middleware) {
    if (middleware === void 0) {
      middleware = ItoI;
    }
    var buffer = [];
    var assigned = false;
    var medium = {
      read: function() {
        if (assigned) {
          throw new Error("Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.");
        }
        if (buffer.length) {
          return buffer[buffer.length - 1];
        }
        return defaults;
      },
      useMedium: function(data) {
        var item = middleware(data, assigned);
        buffer.push(item);
        return function() {
          buffer = buffer.filter(function(x) {
            return x !== item;
          });
        };
      },
      assignSyncMedium: function(cb) {
        assigned = true;
        while (buffer.length) {
          var cbs = buffer;
          buffer = [];
          cbs.forEach(cb);
        }
        buffer = {
          push: function(x) {
            return cb(x);
          },
          filter: function() {
            return buffer;
          }
        };
      },
      assignMedium: function(cb) {
        assigned = true;
        var pendingQueue = [];
        if (buffer.length) {
          var cbs = buffer;
          buffer = [];
          cbs.forEach(cb);
          pendingQueue = buffer;
        }
        var executeQueue = function() {
          var cbs2 = pendingQueue;
          pendingQueue = [];
          cbs2.forEach(cb);
        };
        var cycle = function() {
          return Promise.resolve().then(executeQueue);
        };
        cycle();
        buffer = {
          push: function(x) {
            pendingQueue.push(x);
            cycle();
          },
          filter: function(filter) {
            pendingQueue = pendingQueue.filter(filter);
            return buffer;
          }
        };
      }
    };
    return medium;
  }
  function createSidecarMedium(options) {
    if (options === void 0) {
      options = {};
    }
    var medium = innerCreateMedium(null);
    medium.options = __assign({ async: true, ssr: false }, options);
    return medium;
  }

  // node_modules/use-sidecar/dist/es2015/exports.js
  var React16 = __toESM(require_react());
  var SideCar = function(_a) {
    var sideCar = _a.sideCar, rest = __rest(_a, ["sideCar"]);
    if (!sideCar) {
      throw new Error("Sidecar: please provide `sideCar` property to import the right car");
    }
    var Target = sideCar.read();
    if (!Target) {
      throw new Error("Sidecar medium not found");
    }
    return React16.createElement(Target, __assign({}, rest));
  };
  SideCar.isSideCarExport = true;
  function exportSidecar(medium, exported) {
    medium.useMedium(exported);
    return SideCar;
  }

  // node_modules/react-remove-scroll/dist/es2015/medium.js
  var effectCar = createSidecarMedium();

  // node_modules/react-remove-scroll/dist/es2015/UI.js
  var nothing = function() {
    return;
  };
  var RemoveScroll = React17.forwardRef(function(props, parentRef) {
    var ref = React17.useRef(null);
    var _a = React17.useState({
      onScrollCapture: nothing,
      onWheelCapture: nothing,
      onTouchMoveCapture: nothing
    }), callbacks = _a[0], setCallbacks = _a[1];
    var forwardProps = props.forwardProps, children = props.children, className = props.className, removeScrollBar = props.removeScrollBar, enabled = props.enabled, shards = props.shards, sideCar = props.sideCar, noRelative = props.noRelative, noIsolation = props.noIsolation, inert = props.inert, allowPinchZoom = props.allowPinchZoom, _b = props.as, Container = _b === void 0 ? "div" : _b, gapMode = props.gapMode, rest = __rest(props, ["forwardProps", "children", "className", "removeScrollBar", "enabled", "shards", "sideCar", "noRelative", "noIsolation", "inert", "allowPinchZoom", "as", "gapMode"]);
    var SideCar2 = sideCar;
    var containerRef = useMergeRefs([ref, parentRef]);
    var containerProps = __assign(__assign({}, rest), callbacks);
    return React17.createElement(
      React17.Fragment,
      null,
      enabled && React17.createElement(SideCar2, { sideCar: effectCar, removeScrollBar, shards, noRelative, noIsolation, inert, setCallbacks, allowPinchZoom: !!allowPinchZoom, lockRef: ref, gapMode }),
      forwardProps ? React17.cloneElement(React17.Children.only(children), __assign(__assign({}, containerProps), { ref: containerRef })) : React17.createElement(Container, __assign({}, containerProps, { className, ref: containerRef }), children)
    );
  });
  RemoveScroll.defaultProps = {
    enabled: true,
    removeScrollBar: true,
    inert: false
  };
  RemoveScroll.classNames = {
    fullWidth: fullWidthClassName,
    zeroRight: zeroRightClassName
  };

  // node_modules/react-remove-scroll/dist/es2015/SideEffect.js
  var React20 = __toESM(require_react());

  // node_modules/react-remove-scroll-bar/dist/es2015/component.js
  var React19 = __toESM(require_react());

  // node_modules/react-style-singleton/dist/es2015/hook.js
  var React18 = __toESM(require_react());

  // node_modules/get-nonce/dist/es2015/index.js
  var currentNonce;
  var getNonce = function() {
    if (currentNonce) {
      return currentNonce;
    }
    if (typeof __webpack_nonce__ !== "undefined") {
      return __webpack_nonce__;
    }
    return void 0;
  };

  // node_modules/react-style-singleton/dist/es2015/singleton.js
  function makeStyleTag() {
    if (!document)
      return null;
    var tag = document.createElement("style");
    tag.type = "text/css";
    var nonce = getNonce();
    if (nonce) {
      tag.setAttribute("nonce", nonce);
    }
    return tag;
  }
  function injectStyles(tag, css) {
    if (tag.styleSheet) {
      tag.styleSheet.cssText = css;
    } else {
      tag.appendChild(document.createTextNode(css));
    }
  }
  function insertStyleTag(tag) {
    var head = document.head || document.getElementsByTagName("head")[0];
    head.appendChild(tag);
  }
  var stylesheetSingleton = function() {
    var counter = 0;
    var stylesheet = null;
    return {
      add: function(style) {
        if (counter == 0) {
          if (stylesheet = makeStyleTag()) {
            injectStyles(stylesheet, style);
            insertStyleTag(stylesheet);
          }
        }
        counter++;
      },
      remove: function() {
        counter--;
        if (!counter && stylesheet) {
          stylesheet.parentNode && stylesheet.parentNode.removeChild(stylesheet);
          stylesheet = null;
        }
      }
    };
  };

  // node_modules/react-style-singleton/dist/es2015/hook.js
  var styleHookSingleton = function() {
    var sheet = stylesheetSingleton();
    return function(styles, isDynamic) {
      React18.useEffect(function() {
        sheet.add(styles);
        return function() {
          sheet.remove();
        };
      }, [styles && isDynamic]);
    };
  };

  // node_modules/react-style-singleton/dist/es2015/component.js
  var styleSingleton = function() {
    var useStyle = styleHookSingleton();
    var Sheet = function(_a) {
      var styles = _a.styles, dynamic = _a.dynamic;
      useStyle(styles, dynamic);
      return null;
    };
    return Sheet;
  };

  // node_modules/react-remove-scroll-bar/dist/es2015/utils.js
  var zeroGap = {
    left: 0,
    top: 0,
    right: 0,
    gap: 0
  };
  var parse = function(x) {
    return parseInt(x || "", 10) || 0;
  };
  var getOffset = function(gapMode) {
    var cs = window.getComputedStyle(document.body);
    var left = cs[gapMode === "padding" ? "paddingLeft" : "marginLeft"];
    var top = cs[gapMode === "padding" ? "paddingTop" : "marginTop"];
    var right = cs[gapMode === "padding" ? "paddingRight" : "marginRight"];
    return [parse(left), parse(top), parse(right)];
  };
  var getGapWidth = function(gapMode) {
    if (gapMode === void 0) {
      gapMode = "margin";
    }
    if (typeof window === "undefined") {
      return zeroGap;
    }
    var offsets = getOffset(gapMode);
    var documentWidth = document.documentElement.clientWidth;
    var windowWidth = window.innerWidth;
    return {
      left: offsets[0],
      top: offsets[1],
      right: offsets[2],
      gap: Math.max(0, windowWidth - documentWidth + offsets[2] - offsets[0])
    };
  };

  // node_modules/react-remove-scroll-bar/dist/es2015/component.js
  var Style = styleSingleton();
  var lockAttribute = "data-scroll-locked";
  var getStyles = function(_a, allowRelative, gapMode, important) {
    var left = _a.left, top = _a.top, right = _a.right, gap = _a.gap;
    if (gapMode === void 0) {
      gapMode = "margin";
    }
    return "\n  .".concat(noScrollbarsClassName, " {\n   overflow: hidden ").concat(important, ";\n   padding-right: ").concat(gap, "px ").concat(important, ";\n  }\n  body[").concat(lockAttribute, "] {\n    overflow: hidden ").concat(important, ";\n    overscroll-behavior: contain;\n    ").concat([
      allowRelative && "position: relative ".concat(important, ";"),
      gapMode === "margin" && "\n    padding-left: ".concat(left, "px;\n    padding-top: ").concat(top, "px;\n    padding-right: ").concat(right, "px;\n    margin-left:0;\n    margin-top:0;\n    margin-right: ").concat(gap, "px ").concat(important, ";\n    "),
      gapMode === "padding" && "padding-right: ".concat(gap, "px ").concat(important, ";")
    ].filter(Boolean).join(""), "\n  }\n  \n  .").concat(zeroRightClassName, " {\n    right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " {\n    margin-right: ").concat(gap, "px ").concat(important, ";\n  }\n  \n  .").concat(zeroRightClassName, " .").concat(zeroRightClassName, " {\n    right: 0 ").concat(important, ";\n  }\n  \n  .").concat(fullWidthClassName, " .").concat(fullWidthClassName, " {\n    margin-right: 0 ").concat(important, ";\n  }\n  \n  body[").concat(lockAttribute, "] {\n    ").concat(removedBarSizeVariable, ": ").concat(gap, "px;\n  }\n");
  };
  var getCurrentUseCounter = function() {
    var counter = parseInt(document.body.getAttribute(lockAttribute) || "0", 10);
    return isFinite(counter) ? counter : 0;
  };
  var useLockAttribute = function() {
    React19.useEffect(function() {
      document.body.setAttribute(lockAttribute, (getCurrentUseCounter() + 1).toString());
      return function() {
        var newCounter = getCurrentUseCounter() - 1;
        if (newCounter <= 0) {
          document.body.removeAttribute(lockAttribute);
        } else {
          document.body.setAttribute(lockAttribute, newCounter.toString());
        }
      };
    }, []);
  };
  var RemoveScrollBar = function(_a) {
    var noRelative = _a.noRelative, noImportant = _a.noImportant, _b = _a.gapMode, gapMode = _b === void 0 ? "margin" : _b;
    useLockAttribute();
    var gap = React19.useMemo(function() {
      return getGapWidth(gapMode);
    }, [gapMode]);
    return React19.createElement(Style, { styles: getStyles(gap, !noRelative, gapMode, !noImportant ? "!important" : "") });
  };

  // node_modules/react-remove-scroll/dist/es2015/aggresiveCapture.js
  var passiveSupported = false;
  if (typeof window !== "undefined") {
    try {
      options = Object.defineProperty({}, "passive", {
        get: function() {
          passiveSupported = true;
          return true;
        }
      });
      window.addEventListener("test", options, options);
      window.removeEventListener("test", options, options);
    } catch (err) {
      passiveSupported = false;
    }
  }
  var options;
  var nonPassive = passiveSupported ? { passive: false } : false;

  // node_modules/react-remove-scroll/dist/es2015/handleScroll.js
  var alwaysContainsScroll = function(node) {
    return node.tagName === "TEXTAREA";
  };
  var elementCanBeScrolled = function(node, overflow) {
    if (!(node instanceof Element)) {
      return false;
    }
    var styles = window.getComputedStyle(node);
    return (
      // not-not-scrollable
      styles[overflow] !== "hidden" && // contains scroll inside self
      !(styles.overflowY === styles.overflowX && !alwaysContainsScroll(node) && styles[overflow] === "visible")
    );
  };
  var elementCouldBeVScrolled = function(node) {
    return elementCanBeScrolled(node, "overflowY");
  };
  var elementCouldBeHScrolled = function(node) {
    return elementCanBeScrolled(node, "overflowX");
  };
  var locationCouldBeScrolled = function(axis, node) {
    var ownerDocument = node.ownerDocument;
    var current = node;
    do {
      if (typeof ShadowRoot !== "undefined" && current instanceof ShadowRoot) {
        current = current.host;
      }
      var isScrollable = elementCouldBeScrolled(axis, current);
      if (isScrollable) {
        var _a = getScrollVariables(axis, current), scrollHeight = _a[1], clientHeight = _a[2];
        if (scrollHeight > clientHeight) {
          return true;
        }
      }
      current = current.parentNode;
    } while (current && current !== ownerDocument.body);
    return false;
  };
  var getVScrollVariables = function(_a) {
    var scrollTop = _a.scrollTop, scrollHeight = _a.scrollHeight, clientHeight = _a.clientHeight;
    return [
      scrollTop,
      scrollHeight,
      clientHeight
    ];
  };
  var getHScrollVariables = function(_a) {
    var scrollLeft = _a.scrollLeft, scrollWidth = _a.scrollWidth, clientWidth = _a.clientWidth;
    return [
      scrollLeft,
      scrollWidth,
      clientWidth
    ];
  };
  var elementCouldBeScrolled = function(axis, node) {
    return axis === "v" ? elementCouldBeVScrolled(node) : elementCouldBeHScrolled(node);
  };
  var getScrollVariables = function(axis, node) {
    return axis === "v" ? getVScrollVariables(node) : getHScrollVariables(node);
  };
  var getDirectionFactor = function(axis, direction) {
    return axis === "h" && direction === "rtl" ? -1 : 1;
  };
  var handleScroll = function(axis, endTarget, event, sourceDelta, noOverscroll) {
    var directionFactor = getDirectionFactor(axis, window.getComputedStyle(endTarget).direction);
    var delta = directionFactor * sourceDelta;
    var target = event.target;
    var targetInLock = endTarget.contains(target);
    var shouldCancelScroll = false;
    var isDeltaPositive = delta > 0;
    var availableScroll = 0;
    var availableScrollTop = 0;
    do {
      if (!target) {
        break;
      }
      var _a = getScrollVariables(axis, target), position = _a[0], scroll_1 = _a[1], capacity = _a[2];
      var elementScroll = scroll_1 - capacity - directionFactor * position;
      if (position || elementScroll) {
        if (elementCouldBeScrolled(axis, target)) {
          availableScroll += elementScroll;
          availableScrollTop += position;
        }
      }
      var parent_1 = target.parentNode;
      target = parent_1 && parent_1.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? parent_1.host : parent_1;
    } while (
      // portaled content
      !targetInLock && target !== document.body || // self content
      targetInLock && (endTarget.contains(target) || endTarget === target)
    );
    if (isDeltaPositive && (noOverscroll && Math.abs(availableScroll) < 1 || !noOverscroll && delta > availableScroll)) {
      shouldCancelScroll = true;
    } else if (!isDeltaPositive && (noOverscroll && Math.abs(availableScrollTop) < 1 || !noOverscroll && -delta > availableScrollTop)) {
      shouldCancelScroll = true;
    }
    return shouldCancelScroll;
  };

  // node_modules/react-remove-scroll/dist/es2015/SideEffect.js
  var getTouchXY = function(event) {
    return "changedTouches" in event ? [event.changedTouches[0].clientX, event.changedTouches[0].clientY] : [0, 0];
  };
  var getDeltaXY = function(event) {
    return [event.deltaX, event.deltaY];
  };
  var extractRef = function(ref) {
    return ref && "current" in ref ? ref.current : ref;
  };
  var deltaCompare = function(x, y) {
    return x[0] === y[0] && x[1] === y[1];
  };
  var generateStyle = function(id) {
    return "\n  .block-interactivity-".concat(id, " {pointer-events: none;}\n  .allow-interactivity-").concat(id, " {pointer-events: all;}\n");
  };
  var idCounter = 0;
  var lockStack = [];
  function RemoveScrollSideCar(props) {
    var shouldPreventQueue = React20.useRef([]);
    var touchStartRef = React20.useRef([0, 0]);
    var activeAxis = React20.useRef();
    var id = React20.useState(idCounter++)[0];
    var Style2 = React20.useState(styleSingleton)[0];
    var lastProps = React20.useRef(props);
    React20.useEffect(function() {
      lastProps.current = props;
    }, [props]);
    React20.useEffect(function() {
      if (props.inert) {
        document.body.classList.add("block-interactivity-".concat(id));
        var allow_1 = __spreadArray([props.lockRef.current], (props.shards || []).map(extractRef), true).filter(Boolean);
        allow_1.forEach(function(el) {
          return el.classList.add("allow-interactivity-".concat(id));
        });
        return function() {
          document.body.classList.remove("block-interactivity-".concat(id));
          allow_1.forEach(function(el) {
            return el.classList.remove("allow-interactivity-".concat(id));
          });
        };
      }
      return;
    }, [props.inert, props.lockRef.current, props.shards]);
    var shouldCancelEvent = React20.useCallback(function(event, parent) {
      if ("touches" in event && event.touches.length === 2 || event.type === "wheel" && event.ctrlKey) {
        return !lastProps.current.allowPinchZoom;
      }
      var touch = getTouchXY(event);
      var touchStart = touchStartRef.current;
      var deltaX = "deltaX" in event ? event.deltaX : touchStart[0] - touch[0];
      var deltaY = "deltaY" in event ? event.deltaY : touchStart[1] - touch[1];
      var currentAxis;
      var target = event.target;
      var moveDirection = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
      if ("touches" in event && moveDirection === "h" && target.type === "range") {
        return false;
      }
      var selection = window.getSelection();
      var anchorNode = selection && selection.anchorNode;
      var isTouchingSelection = anchorNode ? anchorNode === target || anchorNode.contains(target) : false;
      if (isTouchingSelection) {
        return false;
      }
      var canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
      if (!canBeScrolledInMainDirection) {
        return true;
      }
      if (canBeScrolledInMainDirection) {
        currentAxis = moveDirection;
      } else {
        currentAxis = moveDirection === "v" ? "h" : "v";
        canBeScrolledInMainDirection = locationCouldBeScrolled(moveDirection, target);
      }
      if (!canBeScrolledInMainDirection) {
        return false;
      }
      if (!activeAxis.current && "changedTouches" in event && (deltaX || deltaY)) {
        activeAxis.current = currentAxis;
      }
      if (!currentAxis) {
        return true;
      }
      var cancelingAxis = activeAxis.current || currentAxis;
      return handleScroll(cancelingAxis, parent, event, cancelingAxis === "h" ? deltaX : deltaY, true);
    }, []);
    var shouldPrevent = React20.useCallback(function(_event) {
      var event = _event;
      if (!lockStack.length || lockStack[lockStack.length - 1] !== Style2) {
        return;
      }
      var delta = "deltaY" in event ? getDeltaXY(event) : getTouchXY(event);
      var sourceEvent = shouldPreventQueue.current.filter(function(e) {
        return e.name === event.type && (e.target === event.target || event.target === e.shadowParent) && deltaCompare(e.delta, delta);
      })[0];
      if (sourceEvent && sourceEvent.should) {
        if (event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (!sourceEvent) {
        var shardNodes = (lastProps.current.shards || []).map(extractRef).filter(Boolean).filter(function(node) {
          return node.contains(event.target);
        });
        var shouldStop = shardNodes.length > 0 ? shouldCancelEvent(event, shardNodes[0]) : !lastProps.current.noIsolation;
        if (shouldStop) {
          if (event.cancelable) {
            event.preventDefault();
          }
        }
      }
    }, []);
    var shouldCancel = React20.useCallback(function(name, delta, target, should) {
      var event = { name, delta, target, should, shadowParent: getOutermostShadowParent(target) };
      shouldPreventQueue.current.push(event);
      setTimeout(function() {
        shouldPreventQueue.current = shouldPreventQueue.current.filter(function(e) {
          return e !== event;
        });
      }, 1);
    }, []);
    var scrollTouchStart = React20.useCallback(function(event) {
      touchStartRef.current = getTouchXY(event);
      activeAxis.current = void 0;
    }, []);
    var scrollWheel = React20.useCallback(function(event) {
      shouldCancel(event.type, getDeltaXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
    }, []);
    var scrollTouchMove = React20.useCallback(function(event) {
      shouldCancel(event.type, getTouchXY(event), event.target, shouldCancelEvent(event, props.lockRef.current));
    }, []);
    React20.useEffect(function() {
      lockStack.push(Style2);
      props.setCallbacks({
        onScrollCapture: scrollWheel,
        onWheelCapture: scrollWheel,
        onTouchMoveCapture: scrollTouchMove
      });
      document.addEventListener("wheel", shouldPrevent, nonPassive);
      document.addEventListener("touchmove", shouldPrevent, nonPassive);
      document.addEventListener("touchstart", scrollTouchStart, nonPassive);
      return function() {
        lockStack = lockStack.filter(function(inst) {
          return inst !== Style2;
        });
        document.removeEventListener("wheel", shouldPrevent, nonPassive);
        document.removeEventListener("touchmove", shouldPrevent, nonPassive);
        document.removeEventListener("touchstart", scrollTouchStart, nonPassive);
      };
    }, []);
    var removeScrollBar = props.removeScrollBar, inert = props.inert;
    return React20.createElement(
      React20.Fragment,
      null,
      inert ? React20.createElement(Style2, { styles: generateStyle(id) }) : null,
      removeScrollBar ? React20.createElement(RemoveScrollBar, { noRelative: props.noRelative, gapMode: props.gapMode }) : null
    );
  }
  function getOutermostShadowParent(node) {
    var shadowParent = null;
    while (node !== null) {
      if (node instanceof ShadowRoot) {
        shadowParent = node.host;
        node = node.host;
      }
      node = node.parentNode;
    }
    return shadowParent;
  }

  // node_modules/react-remove-scroll/dist/es2015/sidecar.js
  var sidecar_default = exportSidecar(effectCar, RemoveScrollSideCar);

  // node_modules/react-remove-scroll/dist/es2015/Combination.js
  var ReactRemoveScroll = React21.forwardRef(function(props, ref) {
    return React21.createElement(RemoveScroll, __assign({}, props, { ref, sideCar: sidecar_default }));
  });
  ReactRemoveScroll.classNames = RemoveScroll.classNames;
  var Combination_default = ReactRemoveScroll;

  // node_modules/aria-hidden/dist/es2015/index.js
  var getDefaultParent = function(originalTarget) {
    if (typeof document === "undefined") {
      return null;
    }
    var sampleTarget = Array.isArray(originalTarget) ? originalTarget[0] : originalTarget;
    return sampleTarget.ownerDocument.body;
  };
  var counterMap = /* @__PURE__ */ new WeakMap();
  var uncontrolledNodes = /* @__PURE__ */ new WeakMap();
  var markerMap = {};
  var lockCount = 0;
  var unwrapHost = function(node) {
    return node && (node.host || unwrapHost(node.parentNode));
  };
  var correctTargets = function(parent, targets) {
    return targets.map(function(target) {
      if (parent.contains(target)) {
        return target;
      }
      var correctedTarget = unwrapHost(target);
      if (correctedTarget && parent.contains(correctedTarget)) {
        return correctedTarget;
      }
      console.error("aria-hidden", target, "in not contained inside", parent, ". Doing nothing");
      return null;
    }).filter(function(x) {
      return Boolean(x);
    });
  };
  var applyAttributeToOthers = function(originalTarget, parentNode, markerName, controlAttribute) {
    var targets = correctTargets(parentNode, Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
    if (!markerMap[markerName]) {
      markerMap[markerName] = /* @__PURE__ */ new WeakMap();
    }
    var markerCounter = markerMap[markerName];
    var hiddenNodes = [];
    var elementsToKeep = /* @__PURE__ */ new Set();
    var elementsToStop = new Set(targets);
    var keep = function(el) {
      if (!el || elementsToKeep.has(el)) {
        return;
      }
      elementsToKeep.add(el);
      keep(el.parentNode);
    };
    targets.forEach(keep);
    var deep = function(parent) {
      if (!parent || elementsToStop.has(parent)) {
        return;
      }
      Array.prototype.forEach.call(parent.children, function(node) {
        if (elementsToKeep.has(node)) {
          deep(node);
        } else {
          try {
            var attr = node.getAttribute(controlAttribute);
            var alreadyHidden = attr !== null && attr !== "false";
            var counterValue = (counterMap.get(node) || 0) + 1;
            var markerValue = (markerCounter.get(node) || 0) + 1;
            counterMap.set(node, counterValue);
            markerCounter.set(node, markerValue);
            hiddenNodes.push(node);
            if (counterValue === 1 && alreadyHidden) {
              uncontrolledNodes.set(node, true);
            }
            if (markerValue === 1) {
              node.setAttribute(markerName, "true");
            }
            if (!alreadyHidden) {
              node.setAttribute(controlAttribute, "true");
            }
          } catch (e) {
            console.error("aria-hidden: cannot operate on ", node, e);
          }
        }
      });
    };
    deep(parentNode);
    elementsToKeep.clear();
    lockCount++;
    return function() {
      hiddenNodes.forEach(function(node) {
        var counterValue = counterMap.get(node) - 1;
        var markerValue = markerCounter.get(node) - 1;
        counterMap.set(node, counterValue);
        markerCounter.set(node, markerValue);
        if (!counterValue) {
          if (!uncontrolledNodes.has(node)) {
            node.removeAttribute(controlAttribute);
          }
          uncontrolledNodes.delete(node);
        }
        if (!markerValue) {
          node.removeAttribute(markerName);
        }
      });
      lockCount--;
      if (!lockCount) {
        counterMap = /* @__PURE__ */ new WeakMap();
        counterMap = /* @__PURE__ */ new WeakMap();
        uncontrolledNodes = /* @__PURE__ */ new WeakMap();
        markerMap = {};
      }
    };
  };
  var hideOthers = function(originalTarget, parentNode, markerName) {
    if (markerName === void 0) {
      markerName = "data-aria-hidden";
    }
    var targets = Array.from(Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
    var activeParentNode = parentNode || getDefaultParent(originalTarget);
    if (!activeParentNode) {
      return function() {
        return null;
      };
    }
    targets.push.apply(targets, Array.from(activeParentNode.querySelectorAll("[aria-live], script")));
    return applyAttributeToOthers(targets, activeParentNode, markerName, "aria-hidden");
  };

  // node_modules/@radix-ui/react-dialog/dist/index.mjs
  var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
  var __defProp16 = Object.defineProperty;
  var __name15 = (target, value) => __defProp16(target, "name", { value, configurable: true });
  var DIALOG_NAME = "Dialog";
  var [createDialogContext, createDialogScope] = createContextScope(DIALOG_NAME);
  var [DialogProvider, useDialogContext] = createDialogContext(DIALOG_NAME);
  var Dialog = /* @__PURE__ */ __name15((props) => {
    const {
      __scopeDialog,
      children,
      open: openProp,
      defaultOpen,
      onOpenChange,
      modal = true
    } = props;
    const triggerRef = React24.useRef(null);
    const contentRef = React24.useRef(null);
    const [open, setOpen] = useControllableState({
      prop: openProp,
      defaultProp: defaultOpen ?? false,
      onChange: onOpenChange,
      caller: DIALOG_NAME
    });
    const [titleCount, setTitleCount] = React24.useState(0);
    const [descriptionCount, setDescriptionCount] = React24.useState(0);
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      DialogProvider,
      {
        scope: __scopeDialog,
        triggerRef,
        contentRef,
        contentId: useId(),
        titleId: useId(),
        descriptionId: useId(),
        titlePresent: titleCount > 0,
        descriptionPresent: descriptionCount > 0,
        setTitleCount,
        setDescriptionCount,
        open,
        onOpenChange: setOpen,
        onOpenToggle: React24.useCallback(() => setOpen((prevOpen) => !prevOpen), [setOpen]),
        modal,
        children
      }
    );
  }, "Dialog");
  var PORTAL_NAME = "DialogPortal";
  var [PortalProvider, usePortalContext] = createDialogContext(PORTAL_NAME, {
    forceMount: void 0
  });
  var DialogPortal = /* @__PURE__ */ __name15((props) => {
    const { __scopeDialog, forceMount, children, container } = props;
    const context = useDialogContext(PORTAL_NAME, __scopeDialog);
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(PortalProvider, { scope: __scopeDialog, forceMount, children: React24.Children.map(children, (child) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Portal, { asChild: true, container, children: child }) })) });
  }, "DialogPortal");
  var OVERLAY_NAME = "DialogOverlay";
  var DialogOverlay = /* @__PURE__ */ React24.forwardRef(
    /* @__PURE__ */ __name15(function DialogOverlay2(props, forwardedRef) {
      const portalContext = usePortalContext(OVERLAY_NAME, props.__scopeDialog);
      const { forceMount = portalContext.forceMount, ...overlayProps } = props;
      const context = useDialogContext(OVERLAY_NAME, props.__scopeDialog);
      return context.modal ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Presence, { present: forceMount || context.open, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(DialogOverlayImpl, { ...overlayProps, ref: forwardedRef }) }) : null;
    }, "DialogOverlay")
  );
  var Slot = createSlot("DialogOverlay.RemoveScroll");
  var DialogOverlayImpl = /* @__PURE__ */ React24.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name15(function DialogOverlayImpl2(props, forwardedRef) {
      const { __scopeDialog, ...overlayProps } = props;
      const context = useDialogContext(OVERLAY_NAME, __scopeDialog);
      const registerDismissableSurface = useDismissableLayerSurface();
      const composedRefs = useComposedRefs(forwardedRef, registerDismissableSurface);
      return (
        // Make sure `Content` is scrollable even when it doesn't live inside `RemoveScroll`
        // ie. when `Overlay` and `Content` are siblings
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Combination_default, { as: Slot, allowPinchZoom: true, shards: [context.contentRef], children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          Primitive.div,
          {
            "data-state": getState(context.open),
            ...overlayProps,
            ref: composedRefs,
            style: { pointerEvents: "auto", ...overlayProps.style }
          }
        ) })
      );
    }, "DialogOverlayImpl")
  );
  var CONTENT_NAME = "DialogContent";
  var DialogContent = /* @__PURE__ */ React24.forwardRef(
    /* @__PURE__ */ __name15(function DialogContent2(props, forwardedRef) {
      const portalContext = usePortalContext(CONTENT_NAME, props.__scopeDialog);
      const { forceMount = portalContext.forceMount, ...contentProps } = props;
      const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Presence, { present: forceMount || context.open, children: context.modal ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(DialogContentModal, { ...contentProps, ref: forwardedRef }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(DialogContentNonModal, { ...contentProps, ref: forwardedRef }) });
    }, "DialogContent")
  );
  var DialogContentModal = /* @__PURE__ */ React24.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name15(function DialogContentModal2(props, forwardedRef) {
      const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
      const contentRef = React24.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, context.contentRef, contentRef);
      React24.useEffect(() => {
        const content = contentRef.current;
        if (content) return hideOthers(content);
      }, []);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        DialogContentImpl,
        {
          ...props,
          ref: composedRefs,
          trapFocus: context.open,
          disableOutsidePointerEvents: context.open,
          onCloseAutoFocus: composeEventHandlers(props.onCloseAutoFocus, (event) => {
            event.preventDefault();
            context.triggerRef.current?.focus();
          }),
          onPointerDownOutside: composeEventHandlers(props.onPointerDownOutside, (event) => {
            const originalEvent = event.detail.originalEvent;
            const ctrlLeftClick = originalEvent.button === 0 && originalEvent.ctrlKey === true;
            const isRightClick = originalEvent.button === 2 || ctrlLeftClick;
            if (isRightClick) event.preventDefault();
          }),
          onFocusOutside: composeEventHandlers(
            props.onFocusOutside,
            (event) => event.preventDefault()
          )
        }
      );
    }, "DialogContentModal")
  );
  var DialogContentNonModal = /* @__PURE__ */ React24.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name15(function DialogContentNonModal2(props, forwardedRef) {
      const context = useDialogContext(CONTENT_NAME, props.__scopeDialog);
      const hasInteractedOutsideRef = React24.useRef(false);
      const hasPointerDownOutsideRef = React24.useRef(false);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        DialogContentImpl,
        {
          ...props,
          ref: forwardedRef,
          trapFocus: false,
          disableOutsidePointerEvents: false,
          onCloseAutoFocus: (event) => {
            props.onCloseAutoFocus?.(event);
            if (!event.defaultPrevented) {
              if (!hasInteractedOutsideRef.current) context.triggerRef.current?.focus();
              event.preventDefault();
            }
            hasInteractedOutsideRef.current = false;
            hasPointerDownOutsideRef.current = false;
          },
          onInteractOutside: (event) => {
            props.onInteractOutside?.(event);
            if (!event.defaultPrevented) {
              hasInteractedOutsideRef.current = true;
              if (event.detail.originalEvent.type === "pointerdown") {
                hasPointerDownOutsideRef.current = true;
              }
            }
            const target = event.target;
            const targetIsTrigger = context.triggerRef.current?.contains(target);
            if (targetIsTrigger) event.preventDefault();
            if (event.detail.originalEvent.type === "focusin" && hasPointerDownOutsideRef.current) {
              event.preventDefault();
            }
          }
        }
      );
    }, "DialogContentNonModal")
  );
  var DialogContentImpl = /* @__PURE__ */ React24.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name15(function DialogContentImpl2(props, forwardedRef) {
      const { __scopeDialog, trapFocus, onOpenAutoFocus, onCloseAutoFocus, ...contentProps } = props;
      const context = useDialogContext(CONTENT_NAME, __scopeDialog);
      useFocusGuards();
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        FocusScope,
        {
          asChild: true,
          loop: true,
          trapped: trapFocus,
          onMountAutoFocus: onOpenAutoFocus,
          onUnmountAutoFocus: onCloseAutoFocus,
          children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            DismissableLayer,
            {
              role: "dialog",
              id: context.contentId,
              "aria-describedby": context.descriptionPresent ? context.descriptionId : void 0,
              "aria-labelledby": context.titlePresent ? context.titleId : void 0,
              "data-state": getState(context.open),
              ...contentProps,
              ref: forwardedRef,
              deferPointerDownOutside: true,
              onDismiss: () => context.onOpenChange(false)
            }
          )
        }
      ) });
    }, "DialogContentImpl")
  );
  var TITLE_NAME = "DialogTitle";
  var DialogTitle = /* @__PURE__ */ React24.forwardRef(
    /* @__PURE__ */ __name15(function DialogTitle2(props, forwardedRef) {
      const { __scopeDialog, ...titleProps } = props;
      const context = useDialogContext(TITLE_NAME, __scopeDialog);
      const { setTitleCount } = context;
      useLayoutEffect2(() => {
        setTitleCount((count3) => count3 + 1);
        return () => setTitleCount((count3) => count3 - 1);
      }, [setTitleCount]);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Primitive.h2, { id: context.titleId, ...titleProps, ref: forwardedRef });
    }, "DialogTitle")
  );
  var DESCRIPTION_NAME = "DialogDescription";
  var DialogDescription = /* @__PURE__ */ React24.forwardRef(
    // blank line to reduce diff noise
    /* @__PURE__ */ __name15(function DialogDescription2(props, forwardedRef) {
      const { __scopeDialog, ...descriptionProps } = props;
      const context = useDialogContext(DESCRIPTION_NAME, __scopeDialog);
      const { setDescriptionCount } = context;
      useLayoutEffect2(() => {
        setDescriptionCount((count3) => count3 + 1);
        return () => setDescriptionCount((count3) => count3 - 1);
      }, [setDescriptionCount]);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Primitive.p, { id: context.descriptionId, ...descriptionProps, ref: forwardedRef });
    }, "DialogDescription")
  );
  function getState(open) {
    return open ? "open" : "closed";
  }
  __name15(getState, "getState");

  // src/renderer/components/ui.tsx
  var import_jsx_runtime7 = __toESM(require_jsx_runtime());
  function Button({ children, onClick, variant = "default", disabled, title, className = "", autoFocus }) {
    const cls = variant === "accent" ? "btn btn-accent" : variant === "ghost" ? "btn btn-ghost" : "btn";
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", title, disabled, onClick, autoFocus, className: `${cls} ${className}`, children });
  }
  function Switch({ checked, onChange }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "button",
      {
        type: "button",
        role: "switch",
        "aria-checked": checked,
        onClick: () => onChange(!checked),
        className: `switch ${checked ? "switch-on" : ""}`,
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "switch-knob" })
      }
    );
  }
  function Field({
    label,
    hint,
    children,
    inline
  }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: inline ? "flex items-center justify-between gap-4 py-2" : "py-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: inline ? "min-w-0" : "mb-1.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "label", children: label }),
        hint ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "faint mt-0.5 text-[11px] leading-relaxed", children: hint }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: inline ? "shrink-0" : "", children })
    ] });
  }
  function Badge({
    children,
    tone = "default"
  }) {
    const style = {
      default: "",
      accent: "chip-accent",
      ok: "",
      warn: "",
      bad: ""
    };
    const color = tone === "ok" ? { color: "var(--ok)", borderColor: "var(--ok)" } : tone === "warn" ? { color: "var(--warn)", borderColor: "var(--warn)" } : tone === "bad" ? { color: "var(--bad)", borderColor: "var(--bad)" } : void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: `chip ${style[tone] ?? ""}`, style: color, children });
  }
  function Modal({
    open,
    onOpenChange,
    title,
    children,
    footer,
    width = 680
  }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Dialog, { open, onOpenChange, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(DialogPortal, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DialogOverlay, { className: "fixed inset-0 z-40", style: { background: "rgba(0,0,0,.55)" } }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        DialogContent,
        {
          className: "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 shadow-panel",
          style: {
            width: `min(${width}px, 92vw)`,
            background: "var(--panel)",
            borderColor: "var(--line-2)"
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DialogTitle, { className: "mb-3 text-[14px] font-medium", children: title }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DialogDescription, { asChild: true, children }),
            footer ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "mt-4 flex flex-wrap justify-end gap-2", children: footer }) : null
          ]
        }
      )
    ] }) });
  }

  // src/renderer/vpm/lib/view.ts
  function repoHost(url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  function formatTimestamp(timestamp) {
    if (timestamp === null || !Number.isFinite(timestamp)) return "";
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return "";
    }
  }
  function cleanText(value, max = 4e3) {
    if (!value) return "";
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
  }
  function repoErrorLabel(code) {
    if (!code) return "";
    return msg(`vpm.errors.${code}`, void 0, code);
  }

  // src/renderer/vpm/api.ts
  var vpmApi = {
    status() {
      return window.a.vpm.status();
    },
    enable(dataRoot) {
      return window.a.vpm.enable(dataRoot);
    },
    disable() {
      return window.a.vpm.disable();
    },
    pickDataRoot() {
      return window.a.vpm.pickDataRoot();
    },
    reposList() {
      return window.a.vpm.reposList();
    },
    repoAdd(input) {
      return window.a.vpm.repoAdd(input);
    },
    repoRemove(id) {
      return window.a.vpm.repoRemove(id);
    },
    repoUpdate(input) {
      return window.a.vpm.repoUpdate(input);
    },
    repoReorder(ids) {
      return window.a.vpm.repoReorder(ids);
    },
    repoImport(text) {
      return window.a.vpm.repoImport(text);
    },
    repoExport() {
      return window.a.vpm.repoExport();
    },
    repoHeaders(id) {
      return window.a.vpm.repoHeaders(id);
    },
    repoHeadersSet(input) {
      return window.a.vpm.repoHeadersSet(input);
    },
    repoHeadersClear(id) {
      return window.a.vpm.repoHeadersClear(id);
    },
    repoTest(id) {
      return window.a.vpm.repoTest(id);
    },
    backupCreate(input) {
      return window.a.vpm.backupCreate(input);
    },
    backupList(projectKey) {
      return window.a.vpm.backupList(projectKey);
    },
    backupReveal(id) {
      return window.a.vpm.backupReveal(id);
    },
    projectCopy(input) {
      return window.a.vpm.projectCopy(input);
    },
    projectVersionChange(input) {
      return window.a.vpm.projectVersionChange(input);
    },
    projectMigrate(input) {
      return window.a.vpm.projectMigrate(input);
    },
    repoRefresh(id) {
      return window.a.vpm.repoRefresh(id);
    },
    repoRefreshAll() {
      return window.a.vpm.repoRefreshAll();
    },
    networkStatus() {
      return window.a.vpm.networkStatus();
    },
    networkConsent(allow) {
      return window.a.vpm.networkConsent(allow);
    },
    catalogQuery(query) {
      return window.a.vpm.catalogQuery(query);
    },
    packageDetail(name) {
      return window.a.vpm.packageDetail(name);
    },
    packageVersions(name) {
      return window.a.vpm.packageVersions(name);
    },
    projectsList() {
      return window.a.vpm.projectsList();
    },
    projectDetail(projectKey) {
      return window.a.vpm.projectDetail(projectKey);
    },
    projectAdd(input) {
      return window.a.vpm.projectAdd(input);
    },
    projectRemove(projectKey) {
      return window.a.vpm.projectRemove(projectKey);
    },
    projectRescan(projectKey) {
      return window.a.vpm.projectRescan(projectKey);
    },
    projectOpenFolder(projectKey) {
      return window.a.vpm.projectOpenFolder(projectKey);
    },
    planResolve(input) {
      return window.a.vpm.planResolve(input);
    },
    planExplain(planId, name) {
      return window.a.vpm.planExplain(planId, name);
    },
    planApply(input) {
      return window.a.vpm.planApply(input);
    },
    operationStatus(operationId) {
      return window.a.vpm.operationStatus(operationId);
    },
    operationCancel(operationId) {
      return window.a.vpm.operationCancel(operationId);
    },
    operationHistory(projectKey) {
      return window.a.vpm.operationHistory(projectKey);
    },
    operationUndo(operationId) {
      return window.a.vpm.operationUndo(operationId);
    },
    projectCatalog(projectKey) {
      return window.a.vpm.projectCatalog(projectKey);
    },
    unityInstalls() {
      return window.a.vpm.unityInstalls();
    },
    unityRefresh() {
      return window.a.vpm.unityRefresh();
    },
    projectLaunch(input) {
      return window.a.vpm.projectLaunch(input);
    },
    projectLaunchArgs(input) {
      return window.a.vpm.projectLaunchArgs(input);
    },
    projectCreate(input) {
      return window.a.vpm.projectCreate(input);
    },
    templateList() {
      return window.a.vpm.templateList();
    },
    templateFavorite(input) {
      return window.a.vpm.templateFavorite(input);
    },
    templateRecent() {
      return window.a.vpm.templateRecent();
    },
    pickProjectDirectory(title) {
      return window.a.system.pickDirectory({ title });
    },
    onRepoProgress(callback) {
      return window.a.on("vpm:repo-progress", (payload) => callback(payload));
    },
    onRepoDone(callback) {
      return window.a.on("vpm:repo-done", (payload) => callback(payload));
    },
    onOperationStarted(callback) {
      return window.a.on(
        "vpm:operation-started",
        (payload) => callback(payload)
      );
    },
    onOperationProgress(callback) {
      return window.a.on(
        "vpm:operation-progress",
        (payload) => callback(payload)
      );
    },
    onOperationDone(callback) {
      return window.a.on("vpm:operation-done", (payload) => callback(payload));
    },
    openExternal(url) {
      return window.a.system.openExternal(url);
    }
  };

  // src/renderer/vpm/components/ReposPanel.tsx
  var import_jsx_runtime8 = __toESM(require_jsx_runtime());
  function ReposPanel(props) {
    const { t: t3 } = useTranslation();
    const [addOpen, setAddOpen] = (0, import_react10.useState)(false);
    const [url, setUrl] = (0, import_react10.useState)("");
    const [name, setName] = (0, import_react10.useState)("");
    const [adding, setAdding] = (0, import_react10.useState)(false);
    const [addError, setAddError] = (0, import_react10.useState)(null);
    const [editTarget, setEditTarget] = (0, import_react10.useState)(null);
    const [editName, setEditName] = (0, import_react10.useState)("");
    const [editUrl, setEditUrl] = (0, import_react10.useState)("");
    const [editBusy, setEditBusy] = (0, import_react10.useState)(false);
    const [editError, setEditError] = (0, import_react10.useState)(null);
    const [headersTarget, setHeadersTarget] = (0, import_react10.useState)(null);
    const [headerState, setHeaderState] = (0, import_react10.useState)(null);
    const [headerRows, setHeaderRows] = (0, import_react10.useState)([]);
    const [headerBusy, setHeaderBusy] = (0, import_react10.useState)(false);
    const [headerError, setHeaderError] = (0, import_react10.useState)(null);
    const [importOpen, setImportOpen] = (0, import_react10.useState)(false);
    const [importText, setImportText] = (0, import_react10.useState)("");
    const [importBusy, setImportBusy] = (0, import_react10.useState)(false);
    const [importResult, setImportResult] = (0, import_react10.useState)(null);
    const [exportText, setExportText] = (0, import_react10.useState)(null);
    const [actionNotice, setActionNotice] = (0, import_react10.useState)(null);
    const [removeTarget, setRemoveTarget] = (0, import_react10.useState)(null);
    const [removing, setRemoving] = (0, import_react10.useState)(false);
    const [removeError, setRemoveError] = (0, import_react10.useState)(null);
    const toggleEnabled = async (repo, enabled) => {
      setActionNotice(null);
      try {
        await vpmApi.repoUpdate({ id: repo.id, enabled });
        await props.onReload();
      } catch (cause) {
        setActionNotice(errorText(cause));
      }
    };
    const move = async (id, delta) => {
      const ids = props.repos.map((repo) => repo.id);
      const index = ids.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      setActionNotice(null);
      try {
        await vpmApi.repoReorder(ids);
        await props.onReload();
      } catch (cause) {
        setActionNotice(errorText(cause));
      }
    };
    const openEdit = (repo) => {
      setEditTarget(repo);
      setEditName(repo.name);
      setEditUrl(repo.url);
      setEditError(null);
    };
    const submitEdit = async () => {
      if (!editTarget) return;
      setEditBusy(true);
      setEditError(null);
      try {
        await vpmApi.repoUpdate({
          id: editTarget.id,
          name: editName.trim(),
          url: editUrl.trim()
        });
        setEditTarget(null);
        await props.onReload();
      } catch (cause) {
        setEditError(errorText(cause));
      } finally {
        setEditBusy(false);
      }
    };
    const openHeaders = async (repo) => {
      setHeadersTarget(repo);
      setHeaderError(null);
      setHeaderRows([]);
      setHeaderState(null);
      try {
        const state = await vpmApi.repoHeaders(repo.id);
        setHeaderState(state);
        setHeaderRows(state.names.map((name2) => ({ name: name2, value: "" })));
      } catch (cause) {
        setHeaderError(errorText(cause));
      }
    };
    const saveHeaders = async () => {
      if (!headersTarget) return;
      setHeaderBusy(true);
      setHeaderError(null);
      try {
        const headers = {};
        for (const row of headerRows) {
          const name2 = row.name.trim();
          const value = row.value.trim();
          if (!name2 && !value) continue;
          if (!name2 || !value) throw new Error(t3("vpm.repos.headersIncomplete"));
          headers[name2] = value;
        }
        const state = await vpmApi.repoHeadersSet({ id: headersTarget.id, headers });
        setHeaderState(state);
        setHeadersTarget(null);
        setActionNotice(t3("vpm.repos.headersSaved"));
      } catch (cause) {
        setHeaderError(errorText(cause));
      } finally {
        setHeaderBusy(false);
      }
    };
    const clearHeaders = async () => {
      if (!headersTarget) return;
      setHeaderBusy(true);
      setHeaderError(null);
      try {
        await vpmApi.repoHeadersClear(headersTarget.id);
        setHeadersTarget(null);
        setActionNotice(t3("vpm.repos.headersCleared"));
      } catch (cause) {
        setHeaderError(errorText(cause));
      } finally {
        setHeaderBusy(false);
      }
    };
    const testRepo = async (repo) => {
      setActionNotice(null);
      try {
        const result = await vpmApi.repoTest(repo.id);
        setActionNotice(
          result.ok ? t3("vpm.repos.testOk", { status: result.status ?? 200 }) : t3("vpm.repos.testFailed", { error: repoErrorLabel(result.errorCode) ?? "\u2014" })
        );
      } catch (cause) {
        setActionNotice(errorText(cause));
      }
    };
    const openImport = async () => {
      setImportText("");
      setImportResult(null);
      setImportOpen(true);
    };
    const submitImport = async () => {
      setImportBusy(true);
      setImportResult(null);
      try {
        const result = await vpmApi.repoImport(importText);
        setImportResult(
          t3("vpm.repos.importDone", { added: result.added.length, skipped: result.skipped.length })
        );
        await props.onReload();
      } catch (cause) {
        setImportResult(errorText(cause));
      } finally {
        setImportBusy(false);
      }
    };
    const doExport = async () => {
      try {
        setExportText(await vpmApi.repoExport());
      } catch (cause) {
        setActionNotice(errorText(cause));
      }
    };
    const openAdd = () => {
      setUrl("");
      setName("");
      setAddError(null);
      setAddOpen(true);
    };
    const submitAdd = async () => {
      if (!url.trim() || adding) return;
      setAdding(true);
      setAddError(null);
      try {
        await props.onAdd({ url: url.trim(), name: name.trim() || void 0 });
        setAddOpen(false);
        setUrl("");
        setName("");
      } catch (cause) {
        setAddError(errorText(cause));
      } finally {
        setAdding(false);
      }
    };
    const submitRemove = async () => {
      if (!removeTarget || removing) return;
      setRemoving(true);
      setRemoveError(null);
      try {
        await props.onRemove(removeTarget.id);
        setRemoveTarget(null);
      } catch (cause) {
        setRemoveError(errorText(cause));
      } finally {
        setRemoving(false);
      }
    };
    const networkAllowed = props.network?.allowed === true;
    const progress = props.operation ? Math.min(100, Math.round(props.operation.done / Math.max(1, props.operation.total) * 100)) : 0;
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-3", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "min-w-0", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h4", { className: "text-[13px] font-medium", children: t3("vpm.repos.title") }),
            networkAllowed ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Badge, { tone: "ok", children: t3("vpm.repos.networkAllowed") }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Badge, { tone: "warn", children: t3("vpm.repos.cacheOnly") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint mt-1 text-[11px] leading-relaxed", children: t3("vpm.repos.intro") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex shrink-0 items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "faint text-[11px]", children: t3("vpm.repos.network") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            Switch,
            {
              checked: networkAllowed,
              onChange: (value) => void props.onSetNetwork(value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "accent", onClick: openAdd, disabled: props.busy, children: t3("vpm.repos.add") })
        ] })
      ] }),
      !networkAllowed ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          className: "rounded border px-3 py-2 text-[11px] leading-relaxed",
          style: { borderColor: "var(--warn)", color: "var(--warn)" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { children: t3("vpm.repos.noConsent") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "mt-2 flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: () => void props.onSetNetwork(true), children: t3("vpm.repos.allowNetwork") }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t3("vpm.repos.officialHint") })
            ] })
          ]
        }
      ) : null,
      actionNotice ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          className: "flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px]",
          style: { borderColor: "var(--line-2)", color: "var(--muted)" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: actionNotice }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: () => setActionNotice(null), children: t3("common.close") })
          ]
        }
      ) : null,
      props.notice ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          className: "flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px]",
          style: { borderColor: "var(--line-2)", color: "var(--muted)" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: props.notice }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: props.onDismissNotice, children: t3("common.close") })
          ]
        }
      ) : null,
      props.error ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
        "div",
        {
          className: "rounded border px-3 py-2 text-[11px] leading-relaxed",
          style: { borderColor: "var(--bad)", color: "var(--bad)" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { children: props.error }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "mt-2", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: props.onReload, children: t3("common.reload") }) })
          ]
        }
      ) : null,
      props.operation ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rounded border px-3 py-2 text-[11px]", style: { borderColor: "var(--line-2)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-center justify-between gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t3("vpm.operation.refreshing", {
            done: props.operation.done,
            total: props.operation.total
          }) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "faint", children: [
            progress,
            "%"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "mt-1.5 h-1 overflow-hidden rounded", style: { background: "var(--line)" }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            className: "h-full transition-[width]",
            style: { width: `${progress}%`, background: "var(--accent)" }
          }
        ) })
      ] }) : null,
      props.loading && !props.repos.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "faint rounded border px-3 py-4 text-[11px]", style: { borderColor: "var(--line)" }, children: t3("common.loading") }) : null,
      !props.loading && !props.error && !props.repos.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rounded border p-3", style: { borderColor: "var(--line)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "text-[12px]", children: t3("vpm.repos.empty") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint mt-1 text-[11px] leading-relaxed", children: t3("vpm.repos.emptyHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "mt-3 flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "accent", onClick: openAdd, disabled: props.busy, children: t3("vpm.repos.add") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: props.onUseOfficial, disabled: props.busy, children: t3("vpm.repos.useOfficial") })
        ] })
      ] }) : null,
      props.repos.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-center justify-end gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: () => void openImport(), disabled: props.busy, children: t3("vpm.repos.import") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "ghost", onClick: () => void doExport(), disabled: props.busy, children: t3("vpm.repos.export") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            Button,
            {
              variant: "ghost",
              onClick: props.onRefreshAll,
              disabled: props.busy || !!props.operation || !networkAllowed,
              children: props.operation ? t3("vpm.repos.refreshing") : t3("vpm.repos.refreshAll")
            }
          )
        ] }),
        props.repos.map((repo) => {
          const lastSuccess = formatTimestamp(repo.lastSuccessAt);
          const lastError = repoErrorLabel(repo.lastErrorCode);
          return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "div",
            {
              className: "rounded border p-3",
              style: { borderColor: "var(--line)" },
              children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "min-w-0", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "text-[12px] font-medium", children: repo.name }),
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Badge, { children: t3("vpm.repos.packages", { count: repo.packageCount }) })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "faint mt-1 break-all text-[11px]", children: repoHost(repo.url) }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "faint mt-1 text-[11px]", children: lastSuccess ? t3("vpm.repos.lastSuccess", { time: lastSuccess }) : t3("vpm.repos.never") }),
                  lastError ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "mt-1 text-[11px]", style: { color: "var(--bad)" }, children: t3("vpm.repos.lastError", { error: lastError }) }) : null
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex shrink-0 flex-wrap items-center justify-end gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Switch,
                    {
                      checked: repo.enabled,
                      onChange: (value) => void toggleEnabled(repo, value)
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => void move(repo.id, -1),
                      disabled: props.busy || props.repos[0]?.id === repo.id,
                      title: t3("vpm.repos.moveUp"),
                      "aria-label": t3("vpm.repos.moveUp"),
                      className: "px-2 text-[14px] font-bold leading-none",
                      children: "\u25B2"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => void move(repo.id, 1),
                      disabled: props.busy || props.repos[props.repos.length - 1]?.id === repo.id,
                      title: t3("vpm.repos.moveDown"),
                      "aria-label": t3("vpm.repos.moveDown"),
                      className: "px-2 text-[14px] font-bold leading-none",
                      children: "\u25BC"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => openEdit(repo),
                      disabled: props.busy || !!props.operation,
                      children: t3("vpm.repos.edit")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => void openHeaders(repo),
                      disabled: props.busy || !!props.operation,
                      children: t3("vpm.repos.headers")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => void testRepo(repo),
                      disabled: props.busy || !!props.operation || !networkAllowed,
                      children: t3("vpm.repos.test")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => props.onRefresh(repo.id),
                      disabled: props.busy || !!props.operation || !networkAllowed,
                      children: t3("vpm.repos.refresh")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    Button,
                    {
                      variant: "ghost",
                      onClick: () => {
                        setRemoveError(null);
                        setRemoveTarget(repo);
                      },
                      disabled: props.busy || !!props.operation,
                      children: t3("vpm.repos.remove")
                    }
                  )
                ] })
              ] })
            },
            repo.id
          );
        })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rounded border p-3", style: { borderColor: "var(--line)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "min-w-0", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "text-[12px] font-medium", children: t3("vpm.catalog.title") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint mt-1 text-[11px] leading-relaxed", children: t3("vpm.catalog.intro") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            Button,
            {
              variant: "ghost",
              onClick: props.onBrowse,
              disabled: !props.repos.length || props.busy,
              children: t3("vpm.catalog.browse")
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint mt-2 text-[11px] leading-relaxed", children: t3("vpm.catalog.installLater") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: addOpen,
          onOpenChange: (open) => {
            if (!adding) setAddOpen(open);
          },
          title: t3("vpm.repos.addTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setAddOpen(false), disabled: adding, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "accent", onClick: () => void submitAdd(), disabled: adding || !url.trim(), children: adding ? t3("vpm.repos.adding") : t3("vpm.repos.add") })
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Field, { label: t3("vpm.repos.url"), hint: t3("vpm.repos.urlHint"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "input",
              {
                className: "input font-mono",
                value: url,
                placeholder: "https://example.com/repo.json",
                onChange: (event) => {
                  setUrl(event.target.value);
                  setAddError(null);
                }
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Field, { label: t3("vpm.repos.name"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "input",
              {
                className: "input",
                value: name,
                placeholder: t3("vpm.repos.namePlaceholder"),
                onChange: (event) => setName(event.target.value)
              }
            ) }),
            addError ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rounded border px-2 py-1.5 text-[11px]", style: { borderColor: "var(--bad)", color: "var(--bad)" }, children: addError }) : null
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: !!removeTarget,
          onOpenChange: (open) => {
            if (!removing && !open) setRemoveTarget(null);
          },
          title: t3("vpm.repos.removeTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setRemoveTarget(null), disabled: removing, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => void submitRemove(), disabled: removing, children: t3("vpm.repos.remove") })
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "text-[12px] leading-relaxed", style: { color: "var(--muted)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { children: t3("vpm.repos.removeBody") }),
            removeTarget ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "mt-2 font-mono text-[11px]", children: removeTarget.name }) : null,
            removeError ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "mt-2 rounded border px-2 py-1.5 text-[11px]", style: { borderColor: "var(--bad)", color: "var(--bad)" }, children: removeError }) : null
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: !!editTarget,
          onOpenChange: (open) => {
            if (!editBusy && !open) setEditTarget(null);
          },
          title: t3("vpm.repos.editTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setEditTarget(null), disabled: editBusy, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              Button,
              {
                variant: "accent",
                onClick: () => void submitEdit(),
                disabled: editBusy || !editName.trim() || !editUrl.trim(),
                children: editBusy ? t3("common.saving") : t3("common.save")
              }
            )
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Field, { label: t3("vpm.repos.name"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "input",
              {
                className: "input",
                value: editName,
                onChange: (event) => setEditName(event.target.value)
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Field, { label: t3("vpm.repos.url"), hint: t3("vpm.repos.urlHint"), children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "input",
              {
                className: "input font-mono",
                value: editUrl,
                onChange: (event) => setEditUrl(event.target.value)
              }
            ) }),
            editError ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rounded border px-2 py-1.5 text-[11px]", style: { borderColor: "var(--bad)", color: "var(--bad)" }, children: editError }) : null
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: !!headersTarget,
          onOpenChange: (open) => {
            if (!headerBusy && !open) setHeadersTarget(null);
          },
          title: t3("vpm.repos.headersTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setHeadersTarget(null), disabled: headerBusy, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              Button,
              {
                variant: "ghost",
                onClick: () => void clearHeaders(),
                disabled: headerBusy || !headerState?.names.length,
                children: t3("vpm.repos.headersClear")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { variant: "accent", onClick: () => void saveHeaders(), disabled: headerBusy, children: headerBusy ? t3("common.saving") : t3("common.save") })
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.repos.headersHint") }),
            headerState && !headerState.available ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rounded border px-3 py-2 text-[11px]", style: { borderColor: "var(--warn)", color: "var(--warn)" }, children: t3("vpm.repos.headersUnavailable") }) : null,
            headerState?.names.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "text-[11px]", children: t3("vpm.repos.headersPresent", { names: headerState.names.join(", ") }) }) : null,
            headerRows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  className: "input w-[45%] font-mono",
                  placeholder: "Authorization",
                  value: row.name,
                  onChange: (event) => setHeaderRows(
                    (current) => current.map(
                      (item, at) => at === index ? { ...item, name: event.target.value } : item
                    )
                  )
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  className: "input flex-1 font-mono",
                  type: "password",
                  placeholder: "Bearer \u2026",
                  value: row.value,
                  onChange: (event) => setHeaderRows(
                    (current) => current.map(
                      (item, at) => at === index ? { ...item, value: event.target.value } : item
                    )
                  )
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                Button,
                {
                  variant: "ghost",
                  onClick: () => setHeaderRows((current) => current.filter((_, at) => at !== index)),
                  children: "\u2212"
                }
              )
            ] }, index)),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              Button,
              {
                variant: "ghost",
                onClick: () => setHeaderRows((current) => [...current, { name: "", value: "" }]),
                children: t3("vpm.repos.headersAdd")
              }
            ),
            headerError ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rounded border px-2 py-1.5 text-[11px]", style: { borderColor: "var(--bad)", color: "var(--bad)" }, children: headerError }) : null
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: importOpen,
          onOpenChange: (open) => {
            if (!importBusy) setImportOpen(open);
          },
          title: t3("vpm.repos.importTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setImportOpen(false), disabled: importBusy, children: t3("common.close") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              Button,
              {
                variant: "accent",
                onClick: () => void submitImport(),
                disabled: importBusy || !importText.trim(),
                children: importBusy ? t3("vpm.repos.importing") : t3("vpm.repos.import")
              }
            )
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.repos.importHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "textarea",
              {
                className: "input h-40 w-full font-mono text-[11px]",
                value: importText,
                placeholder: "https://example.com/index.json\n# \u6216\u8005\u7C98\u8D34\u5BFC\u51FA\u7684 JSON",
                onChange: (event) => setImportText(event.target.value)
              }
            ),
            importResult ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "text-[11px]", children: importResult }) : null
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        Modal,
        {
          open: exportText !== null,
          onOpenChange: (open) => {
            if (!open) setExportText(null);
          },
          title: t3("vpm.repos.exportTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Button, { onClick: () => setExportText(null), children: t3("common.close") }),
          children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "space-y-2 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.repos.exportHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              "textarea",
              {
                className: "input h-40 w-full font-mono text-[11px]",
                readOnly: true,
                value: exportText ?? ""
              }
            )
          ] })
        }
      )
    ] });
  }

  // src/renderer/vpm/components/projects/VpmMaintenancePanel.tsx
  var import_react11 = __toESM(require_react());
  var import_jsx_runtime9 = __toESM(require_jsx_runtime());
  function VpmMaintenancePanel({
    projectKey,
    detail: detail2,
    onChanged
  }) {
    const { t: t3 } = useTranslation();
    const [backups, setBackups] = (0, import_react11.useState)([]);
    const [backupBusy, setBackupBusy] = (0, import_react11.useState)(false);
    const [progress, setProgress] = (0, import_react11.useState)(null);
    const [backupResult, setBackupResult] = (0, import_react11.useState)(null);
    const [backupError, setBackupError] = (0, import_react11.useState)(null);
    const [showAll, setShowAll] = (0, import_react11.useState)(false);
    const [notice, setNotice] = (0, import_react11.useState)(null);
    const [error, setError] = (0, import_react11.useState)(null);
    const [copyOpen, setCopyOpen] = (0, import_react11.useState)(false);
    const [copyParent, setCopyParent] = (0, import_react11.useState)("");
    const [copyName, setCopyName] = (0, import_react11.useState)("");
    const [copyBusy, setCopyBusy] = (0, import_react11.useState)(false);
    const [versionOpen, setVersionOpen] = (0, import_react11.useState)(false);
    const [editors, setEditors] = (0, import_react11.useState)([]);
    const [targetVersion, setTargetVersion] = (0, import_react11.useState)("");
    const [versionBusy, setVersionBusy] = (0, import_react11.useState)(false);
    const [migrateOpen, setMigrateOpen] = (0, import_react11.useState)(false);
    const [migrateSelected, setMigrateSelected] = (0, import_react11.useState)(/* @__PURE__ */ new Set());
    const [migrateBusy, setMigrateBusy] = (0, import_react11.useState)(false);
    const loadBackups = (0, import_react11.useCallback)(async () => {
      try {
        setBackups(await vpmApi.backupList(projectKey));
      } catch (cause) {
        setError(errorText(cause));
      }
    }, [projectKey]);
    (0, import_react11.useEffect)(() => {
      void loadBackups();
    }, [loadBackups]);
    (0, import_react11.useEffect)(() => {
      return window.a.on("vpm:backup-progress", (payload) => {
        const data = payload;
        if (!data || data.projectKey !== projectKey || !data.phase) return;
        setProgress({
          phase: data.phase,
          files: data.files ?? 0,
          bytes: data.bytes ?? 0,
          percent: data.percent ?? null
        });
      });
    }, [projectKey]);
    const createBackup = async () => {
      setBackupBusy(true);
      setBackupError(null);
      setBackupResult(null);
      setProgress(null);
      setNotice(null);
      try {
        const record = await vpmApi.backupCreate({ projectKey, compression: "normal" });
        setBackupResult(record);
        await loadBackups();
      } catch (cause) {
        setBackupError(errorText(cause));
      } finally {
        setBackupBusy(false);
        setProgress(null);
      }
    };
    const reveal = async (id) => {
      try {
        const result = await vpmApi.backupReveal(id);
        if (!result.ok) setError(t3("vpm.maintenance.revealFailed"));
      } catch (cause) {
        setError(errorText(cause));
      }
    };
    const openCopy = async () => {
      setCopyName(`${detail2.name}-copy`);
      setCopyParent("");
      setError(null);
      setCopyOpen(true);
    };
    const submitCopy = async () => {
      if (!copyParent.trim() || !copyName.trim()) return;
      setCopyBusy(true);
      setError(null);
      try {
        const result = await vpmApi.projectCopy({
          projectKey,
          targetDir: `${copyParent.trim().replace(/[\\/]+$/, "")}\\${copyName.trim()}`
        });
        setCopyOpen(false);
        setNotice(t3("vpm.maintenance.copyDone", { files: result.files }));
        onChanged();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setCopyBusy(false);
      }
    };
    const openVersion = async () => {
      setError(null);
      setTargetVersion(detail2.unityVersion ?? "");
      setVersionOpen(true);
      try {
        const list = await vpmApi.unityInstalls();
        setEditors(list.filter((item) => !item.missing && item.version));
      } catch {
        setEditors([]);
      }
    };
    const submitVersion = async () => {
      if (!targetVersion.trim()) return;
      setVersionBusy(true);
      setError(null);
      try {
        const result = await vpmApi.projectVersionChange({
          projectKey,
          unityVersion: targetVersion.trim(),
          backupFirst: true
        });
        setVersionOpen(false);
        setNotice(
          result.downgrade ? t3("vpm.maintenance.versionDowngraded", { from: result.previous, to: result.next }) : t3("vpm.maintenance.versionChanged", { from: result.previous, to: result.next })
        );
        onChanged();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setVersionBusy(false);
      }
    };
    const candidates = detail2.legacy.candidates.filter(
      (item) => item.match === "packageJson" || item.match === "legacyFolder"
    );
    const openMigrate = () => {
      setMigrateSelected(/* @__PURE__ */ new Set());
      setError(null);
      setMigrateOpen(true);
    };
    const submitMigrate = async () => {
      setMigrateBusy(true);
      setError(null);
      try {
        const picked = candidates.filter(
          (item) => migrateSelected.has(candidateKey(item.name, item.relativePath))
        );
        const result = await vpmApi.projectMigrate({
          projectKey,
          candidates: picked.map((item) => ({
            packageId: item.name,
            relativePath: item.relativePath,
            confidence: item.confidence
          }))
        });
        setMigrateOpen(false);
        setNotice(
          t3("vpm.maintenance.migrateDone", {
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length
          })
        );
        onChanged();
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setMigrateBusy(false);
      }
    };
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "space-y-2", "data-vpm-maintenance": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "text-[14px] font-semibold", children: t3("vpm.maintenance.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Badge, { children: t3("vpm.maintenance.backupCount", { count: backups.filter((item) => item.status === "ok").length }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", disabled: backupBusy, onClick: () => void createBackup(), children: backupBusy ? t3("vpm.maintenance.backingUp") : t3("vpm.maintenance.backupNow") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", disabled: detail2.running, onClick: () => void openCopy(), title: detail2.running ? t3("vpm.maintenance.unityRunning") : void 0, children: t3("vpm.maintenance.copy") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", disabled: detail2.running, onClick: () => void openVersion(), title: detail2.running ? t3("vpm.maintenance.unityRunning") : void 0, children: t3("vpm.maintenance.changeVersion") }),
        candidates.length ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", disabled: detail2.running, onClick: openMigrate, children: t3("vpm.maintenance.migrate", { count: candidates.length }) }) : null
      ] }),
      detail2.running ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-[11px]", style: { color: "var(--warn)" }, children: t3("vpm.maintenance.unityRunning") }) : null,
      backupBusy ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "rounded border px-3 py-2 text-[11px]", style: { borderColor: "var(--line)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: progress?.phase === "zip" ? t3("vpm.maintenance.zipping", { percent: progress.percent ?? 0 }) : t3("vpm.maintenance.collecting", { files: progress?.files ?? 0 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint", children: formatBytes(progress?.bytes ?? 0) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "mt-1.5 h-1 overflow-hidden rounded", style: { background: "var(--line)" }, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          "div",
          {
            className: "h-full transition-[width]",
            style: {
              width: `${progress?.phase === "zip" ? progress.percent ?? 0 : 30}%`,
              background: "var(--accent)"
            }
          }
        ) })
      ] }) : null,
      backupResult ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "rounded border px-3 py-2", style: { borderColor: "var(--ok)" }, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex flex-wrap items-center gap-2 text-[12px]", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { color: "var(--ok)" }, children: t3("vpm.maintenance.backupOk") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint text-[11px]", children: formatBytes(backupResult.size ?? 0) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint text-[11px]", children: formatTimestamp(backupResult.finishedAt ?? backupResult.createdAt) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          Button,
          {
            variant: "ghost",
            className: "ml-auto",
            onClick: () => void reveal(backupResult.id),
            children: t3("vpm.maintenance.openFolder")
          }
        )
      ] }) }) : null,
      backupError ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
        "div",
        {
          className: "flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-[11px]",
          style: { borderColor: "var(--bad)", color: "var(--bad)" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: backupError }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", className: "ml-auto", onClick: () => void createBackup(), children: t3("vpm.maintenance.retry") })
          ]
        }
      ) : null,
      notice ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-[11px]", style: { color: "var(--ok)" }, children: notice }) : null,
      error ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "rounded border px-3 py-2 text-[11px]", style: { borderColor: "var(--bad)", color: "var(--bad)" }, children: error }) : null,
      backups.length ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "rounded border", style: { borderColor: "var(--line)" }, children: [
        (showAll ? backups : backups.slice(0, 3)).map((item) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
          "div",
          {
            className: "flex flex-wrap items-center gap-2 border-b px-3 py-1.5 last:border-b-0",
            style: { borderColor: "var(--line)" },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Badge, { tone: item.status === "ok" ? "ok" : item.status === "failed" ? "bad" : "warn", children: t3(`vpm.maintenance.status.${item.status}`) }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                "button",
                {
                  type: "button",
                  className: "max-w-[46%] truncate text-left text-[11px] underline-offset-2 hover:underline",
                  title: item.filePath,
                  disabled: item.status !== "ok",
                  onClick: () => void reveal(item.id),
                  children: fileName(item.filePath)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint text-[10px]", children: formatTimestamp(item.createdAt) }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint text-[10px]", children: formatBytes(item.size ?? 0) }),
              item.status !== "ok" && item.errorCode ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "faint font-mono text-[10px]", title: item.errorCode, children: item.errorCode }) : null
            ]
          },
          item.id
        )),
        backups.length > 3 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "px-3 py-1.5", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { variant: "ghost", onClick: () => setShowAll((current) => !current), children: showAll ? t3("vpm.maintenance.less") : t3("vpm.maintenance.more", { count: backups.length - 3 }) }) }) : null
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "faint text-[11px]", children: t3("vpm.maintenance.noBackups") }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        Modal,
        {
          open: copyOpen,
          onOpenChange: (open) => {
            if (!copyBusy) setCopyOpen(open);
          },
          title: t3("vpm.maintenance.copyTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { onClick: () => setCopyOpen(false), disabled: copyBusy, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              Button,
              {
                variant: "accent",
                onClick: () => void submitCopy(),
                disabled: copyBusy || !copyParent.trim() || !copyName.trim(),
                children: copyBusy ? t3("vpm.maintenance.copying") : t3("vpm.maintenance.copy")
              }
            )
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.maintenance.copyHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Field, { label: t3("vpm.maintenance.copyParent"), children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                "input",
                {
                  className: "input flex-1 font-mono",
                  value: copyParent,
                  placeholder: "E:\\\\projects",
                  onChange: (event) => setCopyParent(event.target.value)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                Button,
                {
                  variant: "ghost",
                  onClick: async () => {
                    const picked = await vpmApi.pickProjectDirectory(t3("vpm.maintenance.copyParent"));
                    if (picked) setCopyParent(picked);
                  },
                  children: t3("vpm.create.pick")
                }
              )
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Field, { label: t3("vpm.maintenance.copyName"), children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "input",
              {
                className: "input",
                value: copyName,
                onChange: (event) => setCopyName(event.target.value)
              }
            ) })
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        Modal,
        {
          open: versionOpen,
          onOpenChange: (open) => {
            if (!versionBusy) setVersionOpen(open);
          },
          title: t3("vpm.maintenance.versionTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { onClick: () => setVersionOpen(false), disabled: versionBusy, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              Button,
              {
                variant: "accent",
                onClick: () => void submitVersion(),
                disabled: versionBusy || !targetVersion.trim(),
                children: versionBusy ? t3("vpm.maintenance.versionChanging") : t3("vpm.maintenance.changeVersion")
              }
            )
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "space-y-3 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.maintenance.versionHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Field, { label: t3("vpm.create.unityVersion"), children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
              "select",
              {
                className: "input",
                value: targetVersion,
                onChange: (event) => setTargetVersion(event.target.value),
                children: [
                  targetVersion && !editors.some((item) => item.version === targetVersion) ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: targetVersion, children: targetVersion }) : null,
                  editors.map((item) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: item.version ?? "", children: item.version }, item.id))
                ]
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "text-[11px]", style: { color: "var(--warn)" }, children: t3("vpm.maintenance.versionWarning") })
          ] })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        Modal,
        {
          open: migrateOpen,
          onOpenChange: (open) => {
            if (!migrateBusy) setMigrateOpen(open);
          },
          title: t3("vpm.maintenance.migrateTitle"),
          footer: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Button, { onClick: () => setMigrateOpen(false), disabled: migrateBusy, children: t3("common.cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              Button,
              {
                variant: "accent",
                onClick: () => void submitMigrate(),
                disabled: migrateBusy || migrateSelected.size === 0,
                children: migrateBusy ? t3("vpm.maintenance.migrating") : t3("vpm.maintenance.migrateSelected")
              }
            )
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "space-y-2 text-[12px]", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "faint text-[11px] leading-relaxed", children: t3("vpm.maintenance.migrateHint") }),
            candidates.map((item) => {
              const key = candidateKey(item.name, item.relativePath);
              return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "flex items-start gap-2 rounded border px-3 py-2", style: { borderColor: "var(--line)" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    className: "mt-0.5",
                    checked: migrateSelected.has(key),
                    onChange: (event) => {
                      setMigrateSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "min-w-0 flex-1", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "block break-all font-mono text-[11px]", children: cleanText(item.name ?? item.relativePath ?? "\u2014", 200) }),
                  /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "faint text-[10px]", children: [
                    t3(`vpm.projects.match.${item.match}`),
                    " \xB7 ",
                    t3(`vpm.projects.confidence.${item.confidence}`)
                  ] })
                ] })
              ] }, key);
            })
          ] })
        }
      )
    ] });
  }
  function candidateKey(name, relativePath) {
    return `${name ?? ""}\0${relativePath ?? ""}`;
  }
  function fileName(filePath) {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }
  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index++;
    }
    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  // tools/preview/preview.tsx
  var import_jsx_runtime10 = __toESM(require_jsx_runtime());
  var repos = [
    {
      id: "vrchat-official",
      url: "https://packages.vrchat.com/official?download",
      name: "Official",
      kind: "remote",
      enabled: true,
      sortOrder: 0,
      packageCount: 42,
      lastFetchAt: 17e11,
      lastSuccessAt: 17e11,
      lastErrorCode: null
    },
    {
      id: "vrchat-curated",
      url: "https://packages.vrchat.com/curated?download",
      name: "Curated",
      kind: "remote",
      enabled: false,
      sortOrder: 1,
      packageCount: 128,
      lastFetchAt: 17e11,
      lastSuccessAt: null,
      lastErrorCode: "vpmHttpTimeout"
    }
  ];
  var detail = {
    projectKey: "e://projects//Demo",
    coreId: "core-1",
    path: "E://projects//Demo",
    name: "Demo",
    unityVersion: "2022.3.22f1",
    unityRevision: null,
    running: false,
    detectedBy: ["heartbeat"],
    bridgeVersion: "1.4.0",
    busyReason: null,
    linked: true,
    hasLedger: true,
    lastScanAt: 17e11,
    packageCount: 12,
    legacyCount: 2,
    hasVpmManifest: true,
    manifestHash: "a".repeat(64),
    manifestMtime: 17e11,
    unityExePath: null,
    unityArgsJson: null,
    packages: [],
    warnings: [],
    legacy: {
      readOnly: true,
      truncated: false,
      candidates: [
        { name: "com.vrchat.avatars", relativePath: "Assets/VRCSDK", match: "packageJson", confidence: "high" },
        { name: null, relativePath: "Assets/OldStuff", match: "legacyFolder", confidence: "medium" }
      ]
    }
  };
  var stub = {
    vpm: {
      backupList: async () => [
        {
          id: "b1",
          projectKey: detail.projectKey,
          projectName: "Demo",
          filePath: "E://data//backups//demo//Demo-20261022-201500.zip",
          size: 1284e5,
          sha256: "f".repeat(64),
          unityVersion: "2022.3.22f1",
          packageCount: 128,
          status: "ok",
          createdAt: 17e11,
          finishedAt: 170000009e4,
          errorCode: null
        },
        {
          id: "b2",
          projectKey: detail.projectKey,
          projectName: "Demo",
          filePath: "E://data//backups//demo//Demo-20261021-101500.zip",
          size: 0,
          sha256: null,
          unityVersion: null,
          packageCount: 0,
          status: "failed",
          createdAt: 1699e9,
          finishedAt: 169900001e4,
          errorCode: "vpmBackupFailed"
        }
      ],
      unityInstalls: async () => [],
      repoHeaders: async () => ({ available: true, names: [] }),
      repoTest: async () => ({ ok: true, status: 200, errorCode: null }),
      repoExport: async () => "{}",
      repoImport: async () => ({ added: [], skipped: [] }),
      repoUpdate: async () => repos[0],
      repoReorder: async () => repos
    },
    on: () => () => void 0,
    system: { openExternal: async () => void 0, pickDirectory: async () => null }
  };
  window.a = stub;
  void instance.use(initReactI18next).init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    resources: { "zh-CN": { translation: zh_CN_default } },
    interpolation: { escapeValue: false }
  });
  function App() {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "min-h-screen p-6", style: { background: "var(--bg)", color: "var(--text)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "mx-auto max-w-[1180px] space-y-6", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rounded border p-4", style: { borderColor: "var(--line)", background: "var(--panel)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "mb-2 flex items-center gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "text-[15px] font-medium", children: "\u9879\u76EE" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "badge", children: "3" })
        ] }),
        [
          { name: "22", path: "E:////AtriumProject////22", version: "2022.3.22f1", running: true },
          { name: "33", path: "E:////AtriumProject////33", version: "2022.3.22f1", running: false },
          { name: "shinano-Little Candy", path: "E:////ALCOMProjects////shinano-Little Candy", version: "2022.3.22f1", running: false }
        ].map((item) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
          "div",
          {
            className: "flex min-h-[56px] items-center gap-3 border-b px-3 py-3 text-[13px] last:border-b-0",
            style: { borderColor: "var(--line)" },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
                "span",
                {
                  className: "h-2.5 w-2.5 shrink-0 rounded-full",
                  style: { background: item.running ? "var(--ok)" : "var(--faint)" }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "min-w-0 flex-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex flex-wrap items-center gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "truncate text-[17px] font-semibold", children: item.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "text-[12px]", style: { color: "var(--muted)" }, children: item.version })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "truncate text-[12px]", style: { color: "var(--faint)" }, children: item.path })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "flex shrink-0 items-center gap-1.5", children: [
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "btn", children: item.running ? "\u5DF2\u6253\u5F00" : "\u6253\u5F00" }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { className: "btn btn-ghost", children: "\u7BA1\u7406" }),
                /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "cursor-pointer px-1.5 text-[14px]", style: { color: "var(--muted)" }, children: "\u22EF" })
              ] })
            ]
          },
          item.name
        ))
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "mx-auto mt-6 grid max-w-[1180px] gap-6 lg:grid-cols-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "rounded border p-4", style: { borderColor: "var(--line)", background: "var(--panel)" }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          ReposPanel,
          {
            repos,
            network: { allowed: true, reason: null },
            operation: null,
            loading: false,
            busy: false,
            error: null,
            notice: null,
            onSetNetwork: () => void 0,
            onReload: () => void 0,
            onAdd: () => void 0,
            onRemove: () => void 0,
            onRefresh: () => void 0,
            onRefreshAll: () => void 0,
            onUseOfficial: () => void 0,
            onBrowse: () => void 0,
            onDismissNotice: () => void 0
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "rounded border p-4", style: { borderColor: "var(--line)", background: "var(--panel)" }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(VpmMaintenancePanel, { projectKey: detail.projectKey, detail, onChanged: () => void 0 }) })
      ] })
    ] });
  }
  (0, import_client.createRoot)(document.getElementById("root")).render(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(App, {}));
})();
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

scheduler/cjs/scheduler.production.min.js:
  (**
   * @license React
   * scheduler.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.min.js:
  (**
   * @license React
   * react-dom.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.min.js:
  (**
   * @license React
   * react-jsx-runtime.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
