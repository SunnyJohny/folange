import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaShoppingCart,
  FaTruck,
  FaCreditCard,
  FaClipboardCheck,
  FaCheck,
  FaTimes,
  FaCopy,
} from "react-icons/fa";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { db as appFirestore } from "../firebase";
import {
  FOLANGE_STORE_ID,
  FOLANGE_BROWSER_KEYS,
  folangeDocumentPath,
  folangeUserPath,
  folangeUserOrdersPath,
  folangeUserOrderPath,
  isFolangeOrderPath,
} from "../config/folangePaths";
import {
  doc,
  getDoc,
  addDoc,
  setDoc,
  collection,
  serverTimestamp,
  getFirestore,
  runTransaction,
} from "firebase/firestore/lite";

import { useMyContext } from "../Context/MyContext";
import ShippingAddress from "./ShippingAddress";
import { toast } from "react-toastify";
import { createVirtualAccount } from "../api/vas";

// Payment operations must read committed server data. Firestore Lite uses REST,
// so Checkout does not create watch targets in the regular SDK's listen stream.
// It reuses the existing Firebase app and its authenticated session.
const db = getFirestore(appFirestore.app);
const PAYMENT_SETTINGS_POLL_MS = 15000;
const PAYSTACK_CONFIRMATION_POLL_MS = 5000;

// A disposed effect never delivers an old result or starts another poll. The
// next request starts only after the previous request and callback have settled.
const pollCheckoutDocument = ({ ref, intervalMs, onData, onError }) => {
  let disposed = false;
  let timer = null;
  let inFlight = false;

  const refresh = async () => {
    if (disposed || inFlight) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    inFlight = true;
    try {
      const snap = await getDoc(ref);
      if (!disposed) await onData(snap);
    } catch (error) {
      if (!disposed) {
        try { await onError(error); }
        catch (callbackError) { console.error("Checkout poll error handler failed:", callbackError); }
      }
    } finally {
      inFlight = false;
      if (!disposed) timer = setTimeout(refresh, intervalMs);
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", handleVisibility);
  void refresh();

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
};

const stepsFull = [
  { key: "cart", label: "Cart", icon: <FaShoppingCart /> },
  { key: "shipping", label: "Shipping", icon: <FaTruck /> },
  { key: "review", label: "Review", icon: <FaClipboardCheck /> },
  { key: "payment", label: "Payment", icon: <FaCreditCard /> },
];
const stepsPaymentOnly = [
  { key: "payment", label: "Payment", icon: <FaCreditCard /> },
];

// ✅ UBA VAT SETTINGS (0.4% capped at ₦300)
// Keep the existing UBA charge exactly as it was.
const VAT_RATE = 0.004;
const VAT_CAP = 300;

// ✅ PAYSTACK VAT SETTINGS (1% capped at ₦300)
// This is provider-specific so changing Paystack does not disturb UBA.
const PAYSTACK_VAT_RATE = 0.01;
const PAYSTACK_VAT_CAP = 300;

// ✅ VA Expiry Window (how long customer has to transfer before expiry)
// Global checkout controls. Firestore rules must allow checkout users to read
// folange/main/settings/checkoutPaymentMethods; only trusted FOLANGE admins may write it.
// Missing fields preserve the existing enabled state; explicit false disables.
const CHECKOUT_PAYMENT_SETTINGS_PATH = folangeDocumentPath("settings", "checkoutPaymentMethods").join("/");
const normalizeCheckoutPaymentMethods = (data = {}) => ({
  PAYSTACK_DVA: data?.methods?.PAYSTACK_DVA !== false,
  UBA_VAS: data?.methods?.UBA_VAS !== false,
});


const getFolangeOrderPath = (uid, orderId) =>
  folangeUserOrderPath(uid, orderId).join("/");

const normalizeFolangeOrderPath = (value = "") => {
  const path = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  return isFolangeOrderPath(path) ? path : "";
};

const VA_EXPIRY_MINUTES = 60; // 60 minutes = 1 hour

// ✅ TEST SWITCH: set true to request STATIC VA (no singleDepositLimit / no expireAt)
// Set back to false for normal DYNAMIC per-order/shipment virtual accounts.
const USE_STATIC_VA_FOR_TEST = true;

// ✅ local persistence key (per user)
const getPendingCheckoutCacheKey = (uid) => `folange_pending_checkout_va_${uid}`;

// ✅ local persistence key for last payment result (success/failure)
// This lets the customer close the site, make a transfer, reload later,
// and still see whether the payment succeeded or failed.
const getCheckoutPaymentResultCacheKey = (uid) =>
  `folange_checkout_payment_result_${uid}`;

const normalizeNgPhoneToLocal = (input = "") => {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";

  // Accept pasted +234 / 234 / 00234 numbers, including +234 (0)...
  if (digits.startsWith("00234") && digits.length > 5) {
    digits = digits.slice(5);
  } else if (digits.startsWith("234") && digits.length > 3) {
    digits = digits.slice(3);
  }

  // Leave short edits editable; a complete national number gets its leading 0.
  if (digits.length >= 10 && !digits.startsWith("0")) digits = `0${digits}`;
  return digits.slice(0, 11);
};

const isValidLocalPhone = (value) => /^0\d{10}$/.test(String(value || ""));

const normalizeCheckoutShippingAddress = (address) => {
  if (!address || typeof address !== "object") return address;
  return { ...address, phone: normalizeNgPhoneToLocal(address.phone) };
};

// ✅ Helper: generate random 11-digit BVN (first digit 1–9)
const generateRandomBvn = () => {
  let bvn = "";
  for (let i = 0; i < 11; i++) {
    const digit =
      i === 0
        ? Math.floor(Math.random() * 9) + 1
        : Math.floor(Math.random() * 10);
    bvn += String(digit);
  }
  return bvn;
};

// Normalize the stored phone and ensure a BVN, saving only changed address fields.
const ensureBvnForUser = async (userId, shippingAddress = {}) => {
  const address = normalizeCheckoutShippingAddress(shippingAddress) || {};
  const currentBvn = String(address.bvn || "").trim();
  const addressPatch = {};

  if (!/^\d{11}$/.test(currentBvn)) addressPatch.bvn = generateRandomBvn();
  if (isValidLocalPhone(address.phone) && address.phone !== String(shippingAddress?.phone || "")) {
    addressPatch.phone = address.phone;
  }
  const updatedAddress = { ...address, ...addressPatch };
  if (Object.keys(addressPatch).length === 0) return updatedAddress;

  try {
    await setDoc(
      doc(db, ...folangeUserPath(userId)),
      { shippingAddress: addressPatch },
      { merge: true },
    );
  } catch (e) {
    console.warn("ensureBvnForUser: could not save address updates to Firestore:", e?.message || e);
  }
  return updatedAddress;
};
// ✅ Helper: format expireAt like "yyyy-MM-dd'T'HH:mm:ss.SSS+0100"
const formatExpireAtWithOffset = (dateObj) => {
  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");

  const d = dateObj;
  const yyyy = d.getFullYear();
  const MM = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const SSS = pad3(d.getMilliseconds());

  const tzOffsetMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  const tzh = pad2(Math.floor(abs / 60));
  const tzm = pad2(abs % 60);

  return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}.${SSS}${sign}${tzh}${tzm}`;
};

// ✅ Helper: parse expireAt that may look like "2026-02-20T10:30:00.000+0100"
const parseExpireAtToDate = (expireAtStr) => {
  const s = String(expireAtStr || "").trim();
  if (!s) return null;

  // Convert +0100 to +01:00 to be more widely parseable
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(fixed);
  if (!isNaN(d.getTime())) return d;

  // Fallback: try raw
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2;

  return null;
};

// ✅ Helper: compute remaining time until expiry
const getExpiryRemaining = (expireAtStr) => {
  const d = parseExpireAtToDate(expireAtStr);
  if (!d)
    return { ok: false, msLeft: 0, minutesLeft: 0, hoursLeft: 0, label: "" };

  const msLeft = d.getTime() - Date.now();
  const safeMs = Math.max(0, msLeft);

  const minutesLeft = Math.ceil(safeMs / 60000);
  const hoursLeft = Math.floor(minutesLeft / 60);
  const minsRemainder = minutesLeft % 60;

  let label = "";
  if (minutesLeft <= 0) label = "Expired";
  else if (hoursLeft <= 0)
    label = `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left`;
  else
    label = `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} ${
      minsRemainder ? `${minsRemainder} min` : ""
    } left`.trim();

  return { ok: true, msLeft: safeMs, minutesLeft, hoursLeft, label };
};

/**
 * ✅ VAT calc (0.4% capped at ₦300)
 * - VAT is calculated strictly from "what is to be paid" (the payable base amount),
 *   then ADDED to that payable base to get the final amount.
 */
const calcVat = (amountToBePaidBeforeVat) => {
  const base = Number(amountToBePaidBeforeVat || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const raw = base * VAT_RATE;
  const capped = Math.min(raw, VAT_CAP);
  return Math.round(capped);
};

// ✅ Paystack only: 1% capped at ₦300.
const calcPaystackVat = (amountToBePaidBeforeVat) => {
  const base = Number(amountToBePaidBeforeVat || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const raw = base * PAYSTACK_VAT_RATE;
  const capped = Math.min(raw, PAYSTACK_VAT_CAP);
  return Math.round(capped);
};

// ✅ Helper: yyyy-MM-dd for reconcile endpoint
const formatYyyyMmDd = (d) => {
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// ✅ Helper: Prefer new fullAddress but keep old format as fallback
const getReadableShippingAddress = (shippingAddress = {}) => {
  const full = String(shippingAddress?.fullAddress || "").trim();
  if (full) return full;

  const fallback = [
    shippingAddress?.address,
    shippingAddress?.city,
    shippingAddress?.state,
    shippingAddress?.country,
    shippingAddress?.zip,
  ]
    .filter((x) => String(x || "").trim())
    .join(", ")
    .trim();

  return fallback;
};

const formatNaira = (val) => {
  const n = Number(val || 0);
  if (!Number.isFinite(n)) return "₦0";
  return `₦${n.toLocaleString()}`;
};

// ✅ Friendly error mapping for quota / VAS failures
const getFriendlyVasErrorMessage = (err) => {
  const msg = String(err?.message || err || "");
  const lower = msg.toLowerCase();

  // Firestore / GCP quota exhausted
  if (
    lower.includes("resource_exhausted") ||
    lower.includes("quota exceeded") ||
    err?.code === 8
  ) {
    return "Payment service is temporarily busy (quota reached). Please try again in a few minutes.";
  }

  // generic
  return "Failed to start payment. Please try again.";
};

// ✅ Remove values Firestore cannot store while preserving Firestore sentinels.
// Some products/addresses contain optional undefined fields, and that can make
// only particular orders fail even though other orders work normally.
const sanitizeForFirestore = (value) => {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }

  if (value === null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeForFirestore(entry))
      .filter((entry) => entry !== undefined);
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);

    // Keep Firestore FieldValue/Timestamp objects and other class instances intact.
    if (prototype !== Object.prototype && prototype !== null) return value;

    return Object.entries(value).reduce((clean, [key, entry]) => {
      const sanitized = sanitizeForFirestore(entry);
      if (sanitized !== undefined) clean[key] = sanitized;
      return clean;
    }, {});
  }

  return value;
};

// ✅ Never place large temporary/base64 image bytes inside an order document.
// Product URLs are retained; browser blob URLs and data URLs are excluded.
const getSafeOrderImage = (imageValue) => {
  const image = String(imageValue || "").trim();
  if (!image) return "";

  const lower = image.toLowerCase();
  if (lower.startsWith("data:") || lower.startsWith("blob:")) return "";
  if (image.length > 5000) return "";

  return image;
};

const CheckoutPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [paymentReference, setPaymentReference] = useState(null);

  const {
    currentUser,
    isAdmin: contextIsAdmin,
    cart,
    shipmentFees,
    clearShipmentFees,
    setShipmentFeeStatusPayment,

    // ✅ OPTIONAL cart clear helpers (depends on how your context is built)
    clearCart,
    clearCartItems,
    setCart,
    dispatch,
  } = useMyContext();

  // Match OrdersTable's administrator access check.
  const isAdmin = Boolean(
    contextIsAdmin === true || currentUser?.isAdmin === true ||
    String(currentUser?.role || "").trim().toLowerCase() === "admin"
  );
  const [paymentMethods, setPaymentMethods] = useState(
    normalizeCheckoutPaymentMethods(),
  );
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false);
  const [paymentMethodsError, setPaymentMethodsError] = useState("");
  const [savingPaymentMethod, setSavingPaymentMethod] = useState("");
  const paymentSettingsSaveRef = useRef(false);
  const [paystackTransition, setPaystackTransition] = useState(null);

  useEffect(() => {
    setPaymentMethodsLoaded(false);
    setPaymentMethodsError("");
    if (!currentUser?.uid) return undefined;
    return pollCheckoutDocument({
      ref: doc(db, CHECKOUT_PAYMENT_SETTINGS_PATH),
      intervalMs: PAYMENT_SETTINGS_POLL_MS,
      onData: (snap) => {
        setPaymentMethods(normalizeCheckoutPaymentMethods(snap.data() || {}));
        setPaymentMethodsLoaded(true);
        setPaymentMethodsError("");
      },
      onError: (error) => {
        setPaymentMethodsLoaded(false);
        setPaymentMethodsError("Unable to load payment options. Please reload or contact support.");
        console.error("Checkout payment settings failed:", error);
      },
    });
  }, [currentUser?.uid]);

  const isPaymentMethodAvailable = (provider) =>
    paymentMethodsLoaded && !paymentMethodsError && paymentMethods[provider] === true;

  const requirePaymentMethodAvailable = async (provider) => {
    if (!isPaymentMethodAvailable(provider)) {
      throw new Error("This payment method is currently unavailable.");
    }
    // Recheck saved controls before starting a new payment, including stale tabs.
    const snap = await getDoc(doc(db, CHECKOUT_PAYMENT_SETTINGS_PATH));
    const latest = normalizeCheckoutPaymentMethods(snap.data() || {});
    setPaymentMethods(latest);
    if (!latest[provider]) throw new Error("This payment method has been disabled by the administrator.");
  };

  const togglePaymentMethod = async (provider) => {
    if (!isAdmin || !currentUser?.uid || !paymentMethodsLoaded ||
        paymentMethodsError || paymentSettingsSaveRef.current ||
        !["PAYSTACK_DVA", "UBA_VAS"].includes(provider)) return;
    paymentSettingsSaveRef.current = true;
    setSavingPaymentMethod(provider);
    try {
      const ref = doc(db, CHECKOUT_PAYMENT_SETTINGS_PATH);
      const committed = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        const latest = normalizeCheckoutPaymentMethods(snap.data() || {});
        transaction.set(ref, {
          methods: { [provider]: !latest[provider] },
          updatedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return { ...latest, [provider]: !latest[provider] };
      });
      setPaymentMethods(committed);
    } catch (error) {
      console.error("Payment method update failed:", error);
      toast.error("Unable to save payment option. Check administrator permissions and try again.");
    } finally {
      paymentSettingsSaveRef.current = false;
      setSavingPaymentMethod("");
    }
  };

  useEffect(() => {
    if (!paymentMethodsLoaded || !paymentMethods.PAYSTACK_DVA) {
      setShowPaystackAmountModal(false);
    }
  }, [paymentMethodsLoaded, paymentMethods.PAYSTACK_DVA]);

  // ✅ robust cart clear (works with many context implementations)
  const safeClearCart = () => {
    try {
      if (typeof clearCart === "function") return clearCart();
      if (typeof clearCartItems === "function") return clearCartItems();
      if (typeof setCart === "function") return setCart([]);
      if (typeof dispatch === "function") {
        dispatch({ type: "CLEAR_CART" });
        dispatch({ type: "cart/clear" });
        dispatch({ type: "EMPTY_CART" });
        return;
      }

      try {
        localStorage.removeItem(FOLANGE_BROWSER_KEYS.cart);
      } catch {}
    } catch (e) {
      console.warn("safeClearCart failed:", e?.message || e);
    }
  };

  // ============================
  // ✅ Detect payment mode (KEEP THIS STYLE)
  // ============================
  const modeFromQuery = String(searchParams.get("mode") || "").toLowerCase();
  const modeFromState = String(location?.state?.mode || "").toLowerCase();

  const isShipmentMode =
    modeFromQuery === "shipment" || modeFromState === "shipment";
  const isBalanceMode =
    modeFromQuery === "balance" || modeFromState === "balance";

  // Payment-only UI for shipment + balance
  const isPaymentOnlyMode = isShipmentMode || isBalanceMode;

  // Steps
  const steps = isPaymentOnlyMode ? stepsPaymentOnly : stepsFull;

  // ============================
  // ✅ IDs + amounts from route
  // ============================
  const shipmentOrderId = String(
    location?.state?.orderId || searchParams.get("orderId") || "",
  ).trim();
  const normalizeOrderPath = normalizeFolangeOrderPath;

  const getUserIdFromOrderPath = (value = "") => {
    const match = normalizeOrderPath(value).match(/^folange\/main\/users\/([^/]+)\/orders\/[^/]+$/);
    return match?.[1] || "";
  };

  const shipmentOrderPath = normalizeOrderPath(
    normalizeFolangeOrderPath(location?.state?.orderPath) ||
      searchParams.get("orderPath") ||
      sessionStorage.getItem("folange_shipmentOrderPath") ||
      "",
  );

  const routeUserId = String(
    location?.state?.userId ||
      location?.state?.customerId ||
      searchParams.get("userId") ||
      searchParams.get("customerId") ||
      "",
  ).trim();

  const shipmentOrderOwnerId =
    routeUserId ||
    getUserIdFromOrderPath(shipmentOrderPath) ||
    String(currentUser?.uid || "").trim();

  const shipmentAmountFromState = Number(
    location?.state?.amount ??
      location?.state?.total ??
      location?.state?.totalAmount,
  );
  const shipmentAmountFromQuery = Number(searchParams.get("amount") || 0);
  const shipmentAmountHint =
    Number.isFinite(shipmentAmountFromState) && shipmentAmountFromState > 0
      ? shipmentAmountFromState
      : Number.isFinite(shipmentAmountFromQuery) && shipmentAmountFromQuery > 0
        ? shipmentAmountFromQuery
        : 0;

  // ✅ Balance mode uses same query keys
  const balanceOrderId = String(
    location?.state?.orderId ||
      searchParams.get("orderId") ||
      sessionStorage.getItem("folange_balanceOrderId") ||
      "",
  ).trim();

  const balanceOrderPath = normalizeOrderPath(
    normalizeFolangeOrderPath(location?.state?.orderPath) ||
      searchParams.get("orderPath") ||
      sessionStorage.getItem("folange_balanceOrderPath") ||
      "",
  );

  const balanceOrderOwnerId =
    routeUserId ||
    getUserIdFromOrderPath(balanceOrderPath) ||
    String(sessionStorage.getItem("folange_balanceUserId") || "").trim() ||
    String(currentUser?.uid || "").trim();

  const balanceAmountFromState = Number(
    location?.state?.amount ??
      location?.state?.total ??
      location?.state?.totalAmount,
  );
  const balanceAmountFromQuery = Number(searchParams.get("amount") || 0);
  const balanceAmountHint =
    Number.isFinite(balanceAmountFromState) && balanceAmountFromState > 0
      ? balanceAmountFromState
      : Number.isFinite(balanceAmountFromQuery) && balanceAmountFromQuery > 0
        ? balanceAmountFromQuery
        : 0;

  // ---------------- UI states ----------------
  const [currentStep, setCurrentStep] = useState(
    isPaymentOnlyMode ? "payment" : "shipping",
  );
  const [shippingAddress, setShippingAddress] = useState(null);

  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // ✅ permanent note lock
  const [noteLocked, setNoteLocked] = useState(false);

  // ✅ VAS states
  const [vaLoading, setVaLoading] = useState(false);
  const [virtualAccount, setVirtualAccount] = useState(null);
  const [showVAModal, setShowVAModal] = useState(false);

  // Paystack and UBA share the same account-details modal, but payment
  // confirmation remains provider-specific. UBA keeps query-inflow;
  // Paystack is confirmed only from Firestore after the signed webhook.
  const [activePaymentProvider, setActivePaymentProvider] = useState("");

  // Paystack payment-intent amount.
  // Paystack must know the exact amount the customer intends to transfer.
  const [showPaystackAmountModal, setShowPaystackAmountModal] = useState(false);
  const [paystackPartAmount, setPaystackPartAmount] = useState("");
  const [paystackSelectedAmount, setPaystackSelectedAmount] = useState(0);

  // ✅ track last pending order id
  const [pendingOrderId, setPendingOrderId] = useState(null);

  // store expireAt for UI
  const [vaExpireAt, setVaExpireAt] = useState(null);

  // ✅ remaining time label for UI
  const [vaRemainingLabel, setVaRemainingLabel] = useState("");

  // ✅ reconcile loading
  const [reconLoading, setReconLoading] = useState(false);

  // ✅ load docs
  const [shipmentOrderDoc, setShipmentOrderDoc] = useState(null);
  const [shipmentAmount, setShipmentAmount] = useState(shipmentAmountHint);

  const [balanceOrderDoc, setBalanceOrderDoc] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState(balanceAmountHint);

  // ✅ Thank you modal
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [thankYouData, setThankYouData] = useState({
    amount: 0,
    mode: "order", // "order" | "shipment" | "balance"
    orderId: "",
  });

  // ✅ Failure modal for persisted/reloaded payment failure or expired session
  const [showPaymentFailureModal, setShowPaymentFailureModal] = useState(false);
  const [paymentFailureData, setPaymentFailureData] = useState({
    amount: 0,
    mode: "order", // "order" | "shipment" | "balance"
    orderId: "",
    message: "Payment was not confirmed.",
  });

  // ✅ guards so init effects don't fight each other
  const [restoringPendingVA, setRestoringPendingVA] = useState(true);
  const [pendingRestored, setPendingRestored] = useState(false);

  // ✅ HARD guard against double-click / multiple inflight requests
  const payNowInFlightRef = useRef(false);

  // ✅ NORMAL CHECKOUT SESSION ORDER
  // Only an order created during THIS mounted checkout session may be reused
  // when the customer retries a provider/account request. An old
  // user.pendingOrderId restored from Firestore must never silently become a
  // brand-new sale just because its cart and amount happen to match.
  const currentCheckoutOrderIdRef = useRef("");

  // ✅ AUTO PAYMENT POLLING GUARDS
  // Poll every 10 seconds. After 2 minutes, ask customer if they are still making payment.
  // If they continue, poll for another 2 minutes. If no inflow after that, clear and go home.
  const autoPaymentPollTimerRef = useRef(null);
  const autoPaymentPollStartRef = useRef(0);
  const autoPaymentPollRoundRef = useRef(1);
  const autoPaymentPollStoppedRef = useRef(false);
  const autoPaymentPollInFlightRef = useRef(false);
  const autoPaymentPollPromptOpenRef = useRef(false);

  // -------------------- VARIANTS HELPERS --------------------
  const normalizeVariants = (item) => {
    if (!item) return null;

    const cleanObj = (obj) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      const out = {};
      Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        const s = String(v).trim();
        if (!s) return;
        out[String(k)] = s;
      });
      return Object.keys(out).length ? out : null;
    };

    const fromVariantObject = cleanObj(item.variant);
    if (fromVariantObject) return fromVariantObject;

    const fromVariantsObject = cleanObj(item.variants);
    if (fromVariantsObject) return fromVariantsObject;

    const fromSelectedOptions = cleanObj(item.selectedOptions);
    if (fromSelectedOptions) return fromSelectedOptions;

    const fromOptions = cleanObj(item.options);
    if (fromOptions) return fromOptions;

    const fromAttributes = cleanObj(item.attributes);
    if (fromAttributes) return fromAttributes;

    if (typeof item.variantName === "string" && item.variantName.trim()) {
      return { name: item.variantName.trim() };
    }

    if (typeof item.variant === "string" && item.variant.trim()) {
      return { name: item.variant.trim() };
    }

    if (Array.isArray(item.variants) && item.variants.length) {
      const txt = item.variants
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean)
        .join(", ");
      if (txt) return { name: txt };
    }

    return null;
  };

  const formatVariantsText = (variantsObj) => {
    if (!variantsObj || typeof variantsObj !== "object") return "";
    const entries = Object.entries(variantsObj)
      .filter(
        ([_, v]) => v !== undefined && v !== null && String(v).trim() !== "",
      )
      .map(([k, v]) => `${k}: ${v}`);
    return entries.length ? entries.join(", ") : "";
  };

  // ✅ Compare a saved pending order with the current cart before reusing it.
  // This prevents a payment retry from silently creating a second order.
  const getCartSignature = (items = []) =>
    JSON.stringify(
      (Array.isArray(items) ? items : []).map((item) => {
        const variantsObj = normalizeVariants(item);
        return {
          productId: String(item?.productId || item?.id || "").trim(),
          price: Number(item?.price || 0),
          quantity: Math.max(1, Number(item?.quantity) || 1),
          variantText:
            String(item?.variantText || "").trim() ||
            formatVariantsText(variantsObj),
        };
      }),
    );

  // ✅ Identify which order we should lock notes against
  const orderIdForNotes = useMemo(() => {
    if (isShipmentMode) return shipmentOrderId || "";
    if (isBalanceMode) return balanceOrderId || "";
    return pendingOrderId || "";
  }, [
    isShipmentMode,
    shipmentOrderId,
    isBalanceMode,
    balanceOrderId,
    pendingOrderId,
  ]);

  // ✅ helper: persist pending checkout state locally
  const persistPendingCheckoutCache = (payload) => {
    try {
      const uid = currentUser?.uid;
      if (!uid) return;
      const key = getPendingCheckoutCacheKey(uid);

      if (!payload) {
        localStorage.removeItem(key);
        return;
      }

      localStorage.setItem(
        key,
        JSON.stringify({
          ...payload,
          savedAt: Date.now(),
        }),
      );
    } catch (e) {
      console.warn("persistPendingCheckoutCache failed:", e?.message || e);
    }
  };

  // ✅ helper: persist final payment result so user sees it after reload
  const persistPaymentResultCache = (payload) => {
    try {
      const uid = currentUser?.uid;
      if (!uid) return;
      const key = getCheckoutPaymentResultCacheKey(uid);

      if (!payload) {
        localStorage.removeItem(key);
        return;
      }

      localStorage.setItem(
        key,
        JSON.stringify({
          ...payload,
          savedAt: Date.now(),
        }),
      );
    } catch (e) {
      console.warn("persistPaymentResultCache failed:", e?.message || e);
    }
  };

  const getPaymentModeForCurrentPage = () =>
    isBalanceMode ? "balance" : isShipmentMode ? "shipment" : "order";

  const getCurrentOrderIdForPayment = () =>
    isBalanceMode
      ? balanceOrderId
      : isShipmentMode
        ? shipmentOrderId
        : pendingOrderId;

  // ✅ helper: clear pending markers after confirm/cancel (NORMAL checkout resume)
  const clearPendingPaymentPersistence = async (opts = {}) => {
    const { orderId = "", keepOrderDoc = false } = opts || {};
    const uid = currentUser?.uid;

    try {
      if (!uid) return;

      persistPendingCheckoutCache(null);

      // Clear user-level pointer
      await setDoc(
        doc(db, ...folangeUserPath(uid)),
        { pendingOrderId: null, updatedAt: serverTimestamp() },
        { merge: true },
      );

      // Optional marker on order doc (does not delete the order)
      if (!keepOrderDoc && orderId) {
        await setDoc(
          doc(db, ...folangeUserOrderPath(uid, orderId)),
          {
            updatedAt: serverTimestamp(),
            checkoutState: { pendingVA: false, closedAt: serverTimestamp() },
          },
          { merge: true },
        );
      }
    } catch (e) {
      console.warn("clearPendingPaymentPersistence failed:", e?.message || e);
    }
  };

  // ✅ helper: extract VA from order doc (UBA + Paystack)
  const getVaFromOrderDoc = (order, which = "order") => {
    if (!order) return null;

    const paymentObject =
      which === "shipment"
        ? order?.shipmentPayment?.payment || {}
        : which === "balance"
          ? order?.balancePayment?.payment || {}
          : order?.payment || {};

    const provider = String(paymentObject?.provider || "").toUpperCase();

    // Paystack DVA: assignment webhook stores the account both on the
    // payment object and inside payment.paystack.
    if (provider === "PAYSTACK_DVA") {
      const accountNumber = String(
        paymentObject?.accountNumber ||
          paymentObject?.paystack?.accountNumber ||
          "",
      )
        .replace(/\D/g, "")
        .trim();

      if (!accountNumber) return null;

      return {
        vNUBAN: accountNumber,
        accountNumber,
        accountName:
          paymentObject?.accountName ||
          paymentObject?.paystack?.accountName ||
          "FOLANGE Customer",
        bankName:
          paymentObject?.bankName ||
          paymentObject?.paystack?.bankName ||
          "Paystack",
        bankSlug:
          paymentObject?.bankSlug ||
          paymentObject?.paystack?.bankSlug ||
          "",
        type: "PAYSTACK DVA",
        provider: "PAYSTACK_DVA",
        createdAt:
          paymentObject?.assignedAt ||
          paymentObject?.paystack?.assignedAt ||
          null,
        expireAt: null,
      };
    }

    // Existing UBA VAS shapes remain untouched.
    if (which === "shipment") {
      const shipPay = order?.shipmentPayment?.payment || {};
      const vNUBAN = String(
        shipPay?.vaNuban ||
          shipPay?.vaNUBAN ||
          shipPay?.vNUBAN ||
          shipPay?.vNuban ||
          "",
      )
        .replace(/\D/g, "")
        .trim();
      if (!vNUBAN) return null;

      return {
        vNUBAN,
        accountName:
          shipPay?.vaAccountName || shipPay?.accountName || "Customer",
        bankName: "UBA",
        type: shipPay?.vaType || shipPay?.type || "DYNAMIC",
        provider: "UBA_VAS",
        createdAt: shipPay?.vaCreatedAt || null,
        expireAt: shipPay?.vaExpireAt || null,
      };
    }

    if (which === "balance") {
      const balPay = order?.balancePayment?.payment || {};
      const vNUBAN = String(
        balPay?.vaNuban ||
          balPay?.vaNUBAN ||
          balPay?.vNUBAN ||
          balPay?.vNuban ||
          "",
      )
        .replace(/\D/g, "")
        .trim();
      if (!vNUBAN) return null;

      return {
        vNUBAN,
        accountName:
          balPay?.vaAccountName || balPay?.accountName || "Customer",
        bankName: "UBA",
        type: balPay?.vaType || balPay?.type || "DYNAMIC",
        provider: "UBA_VAS",
        createdAt: balPay?.vaCreatedAt || null,
        expireAt: balPay?.vaExpireAt || null,
      };
    }

    const pay = order?.payment || {};
    const raw = pay?.rawPayload || {};

    const vNUBAN = String(
      pay?.vaNuban ||
        pay?.vaNUBAN ||
        pay?.vNUBAN ||
        pay?.vNuban ||
        raw?.vaNuban ||
        raw?.vaNUBAN ||
        raw?.vNUBAN ||
        raw?.vNuban ||
        "",
    )
      .replace(/\D/g, "")
      .trim();

    if (!vNUBAN) return null;

    return {
      vNUBAN,
      accountName:
        pay?.vaAccountName || raw?.vaAccountName || "Customer",
      bankName: "UBA",
      type:
        pay?.vaType ||
        raw?.vaType ||
        raw?.vaRequestedType ||
        "DYNAMIC",
      provider: "UBA_VAS",
      createdAt: pay?.vaCreatedAt || raw?.vaCreatedAt || null,
      expireAt: pay?.vaExpireAt || raw?.vaExpireAt || null,
    };
  };

  // -------------------- Load shipping info --------------------
  useEffect(() => {
    if (!currentUser) return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, ...folangeUserPath(currentUser.uid)));
        if (snap.exists()) {
          const data = snap.data();
          if (data.shippingAddress) {
            const ensuredAddress = await ensureBvnForUser(
              currentUser.uid,
              data.shippingAddress,
            );
            setShippingAddress(normalizeCheckoutShippingAddress(ensuredAddress));

            // ✅ Only auto-jump to review if we are not restoring a pending VA session
            if (
              !isPaymentOnlyMode &&
              !pendingRestored &&
              !pendingOrderId &&
              !virtualAccount?.vNUBAN
            ) {
              setCurrentStep("review");
            }
          }
        }
      } catch {
        // silent
      }
    })();
  }, [
    currentUser,
    isPaymentOnlyMode,
    pendingRestored,
    pendingOrderId,
    virtualAccount?.vNUBAN,
  ]);

  // ✅ RESTORE pending VA / pending order for NORMAL checkout users
  useEffect(() => {
    if (!currentUser || isPaymentOnlyMode) {
      setRestoringPendingVA(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const uid = currentUser.uid;
        let orderIdToRestore = "";

        // 1) Try user doc pointer first
        const userSnap = await getDoc(doc(db, ...folangeUserPath(uid)));
        const userData = userSnap.exists() ? userSnap.data() || {} : {};
        orderIdToRestore = String(userData?.pendingOrderId || "").trim();

        // 2) Fallback to localStorage cache
        if (!orderIdToRestore) {
          try {
            const raw = localStorage.getItem(getPendingCheckoutCacheKey(uid));
            if (raw) {
              const cached = JSON.parse(raw);
              orderIdToRestore = String(cached?.orderId || "").trim();
            }
          } catch {}
        }

        if (!orderIdToRestore) {
          if (!cancelled) {
            setRestoringPendingVA(false);
            setPendingRestored(false);
          }
          return;
        }

        const orderRef = doc(db, ...folangeUserOrderPath(uid, orderIdToRestore));
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
          try {
            await setDoc(
              doc(db, ...folangeUserPath(uid)),
              { pendingOrderId: null },
              { merge: true },
            );
          } catch {}
          persistPendingCheckoutCache(null);

          if (!cancelled) {
            setRestoringPendingVA(false);
            setPendingRestored(false);
          }
          return;
        }

        const order = orderSnap.data() || {};
        const paid =
          String(order?.orderStatus || "").toLowerCase() === "paid" ||
          String(order?.payment?.status || "").toLowerCase() === "paid" ||
          !!order?.payment?.paidAt;

        const restoredVa = getVaFromOrderDoc(order, "order");

        if (paid) {
          try {
            await setDoc(
              doc(db, ...folangeUserPath(uid)),
              { pendingOrderId: null },
              { merge: true },
            );
          } catch {}
          persistPendingCheckoutCache(null);

          if (!cancelled) {
            openThankYouModal({
              amount: Number(
                order?.payment?.amount || order?.payableTotal || 0,
              ),
              mode: "order",
              orderId: orderIdToRestore,
            });
            setRestoringPendingVA(false);
            setPendingRestored(false);
          }
          return;
        }

        if (restoredVa?.vNUBAN) {
          if (cancelled) return;

          // IMPORTANT:
          // Restore only the pending ORDER, not the previous provider/account modal.
          // This prevents an old UBA VA from taking over Checkout before the
          // customer can choose UBA or Paystack.
          setPendingOrderId(orderIdToRestore);
          setVirtualAccount(null);
          setActivePaymentProvider("");
          setVaExpireAt(null);
          setShowVAModal(false);
          setCurrentStep("payment");
          setPendingRestored(true);

          persistPendingCheckoutCache({
            orderId: orderIdToRestore,
            orderPath:
              normalizeFolangeOrderPath(order?.orderPath) || getFolangeOrderPath(uid, orderIdToRestore),
            mode: "order",
          });
        } else {
          // The order was successfully created but VA generation may have
          // failed. Keep its ID available so Pay Now retries this same order.
          if (!cancelled) {
            setPendingOrderId(orderIdToRestore);
            setPendingRestored(false);
          }

          persistPendingCheckoutCache({
            orderId: orderIdToRestore,
            orderPath:
              normalizeFolangeOrderPath(order?.orderPath) || getFolangeOrderPath(uid, orderIdToRestore),
            mode: "order",
          });
        }
      } catch (e) {
        console.warn("Restore pending VA failed:", e?.message || e);
      } finally {
        if (!cancelled) setRestoringPendingVA(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, isPaymentOnlyMode]);

  // ✅ Load shipment order doc (shipment mode)
  useEffect(() => {
    if (!isShipmentMode || !currentUser || !shipmentOrderId) return;

    (async () => {
      try {
        const orderRef = doc(db, ...folangeUserOrderPath(shipmentOrderOwnerId, shipmentOrderId));
        const snap = await getDoc(orderRef);
        if (!snap.exists()) {
          toast.error("Shipment order not found");
          return;
        }

        const data = snap.data() || {};
        const composed = {
          id: shipmentOrderId,
          ...data,
          userId: data?.userId || shipmentOrderOwnerId,
          orderPath:
            normalizeFolangeOrderPath(data?.orderPath) ||
            shipmentOrderPath ||
            getFolangeOrderPath(shipmentOrderOwnerId, shipmentOrderId),
        };
        setShipmentOrderDoc(composed);
        if (data?.shippingAddress) setShippingAddress(normalizeCheckoutShippingAddress(data.shippingAddress));

        const feeFromOrder = Number(
          data?.shipmentPayment?.amount ??
            data?.shipment?.fee ??
            data?.shipmentFee ??
            0,
        );

        if (Number.isFinite(feeFromOrder) && feeFromOrder > 0)
          setShipmentAmount(feeFromOrder);
        else if (shipmentAmountHint > 0) setShipmentAmount(shipmentAmountHint);

        setPendingOrderId(shipmentOrderId);

        const shipState = String(
          data?.shipmentPayment?.state ||
            data?.shipmentPayment?.payment?.state ||
            "",
        ).toLowerCase();
        const shipPaid = shipState === "paid";
        const restoredShipVa = getVaFromOrderDoc(composed, "shipment");

        if (shipPaid) {
          openThankYouModal({
            amount: Number(
              data?.shipmentPayment?.payment?.amount ||
                data?.shipmentPayment?.payableTotal ||
                data?.shipmentPayment?.amount ||
                shipmentAmountHint ||
                0,
            ),
            mode: "shipment",
            orderId: shipmentOrderId,
          });
        } else if (restoredShipVa?.vNUBAN) {
          // Keep the existing account in Firestore, but do not auto-open it.
          // The customer must choose UBA or Paystack from the payment screen.
          setVirtualAccount(null);
          setActivePaymentProvider("");
          setVaExpireAt(null);
          setShowVAModal(false);
        }

        setCurrentStep("payment");
      } catch (e) {
        console.error("Load shipment order failed:", e);
        toast.error("Unable to load shipment order");
      }
    })();
  }, [
    isShipmentMode,
    currentUser,
    shipmentOrderId,
    shipmentAmountHint,
    shipmentOrderOwnerId,
    shipmentOrderPath,
  ]);

  // ✅ Load balance order doc (balance mode)
  useEffect(() => {
    if (!isBalanceMode || !currentUser || !balanceOrderId) return;

    (async () => {
      try {
        const orderRef = doc(db, ...folangeUserOrderPath(balanceOrderOwnerId, balanceOrderId));
        const snap = await getDoc(orderRef);
        if (!snap.exists()) {
          toast.error("Balance order not found");
          return;
        }

        const data = snap.data() || {};
        const composed = {
          id: balanceOrderId,
          ...data,
          userId: data?.userId || balanceOrderOwnerId,
          orderPath:
            normalizeFolangeOrderPath(data?.orderPath) ||
            balanceOrderPath ||
            getFolangeOrderPath(balanceOrderOwnerId, balanceOrderId),
        };
        setBalanceOrderDoc(composed);
        if (data?.shippingAddress) setShippingAddress(normalizeCheckoutShippingAddress(data.shippingAddress));

        const fromDoc = Number(
          data?.balancePayment?.outstanding ??
            data?.balancePayment?.amount ??
            data?.payment?.outstanding ??
            data?.payment?.inflow?.outstanding ??
            Math.max(
              0,
              Number(data?.payableTotal || 0) -
                Number(
                  data?.payment?.amountPaid ||
                    data?.payment?.inflow?.paidTotal ||
                    0,
                ),
            ),
        );
        const resolved =
          Number.isFinite(balanceAmountHint) && balanceAmountHint > 0
            ? balanceAmountHint
            : Number.isFinite(fromDoc) && fromDoc > 0
              ? fromDoc
              : 0;

        setBalanceAmount(resolved);

        const balState = String(
          data?.balancePayment?.state ||
            data?.balancePayment?.payment?.state ||
            "",
        ).toLowerCase();
        const balPaid = balState === "paid";
        const restoredBalVa = getVaFromOrderDoc(composed, "balance");

        if (balPaid) {
          openThankYouModal({
            amount: Number(
              data?.balancePayment?.payment?.amount ||
                data?.balancePayment?.payableTotal ||
                data?.balancePayment?.amount ||
                balanceAmountHint ||
                0,
            ),
            mode: "balance",
            orderId: balanceOrderId,
          });
        } else if (restoredBalVa?.vNUBAN) {
          // Keep the existing account in Firestore, but do not auto-open it.
          // The customer must choose UBA or Paystack from the payment screen.
          setVirtualAccount(null);
          setActivePaymentProvider("");
          setVaExpireAt(null);
          setShowVAModal(false);
        }

        setCurrentStep("payment");
      } catch (e) {
        console.error("Load balance order failed:", e);
        toast.error("Unable to load balance order");
      }
    })();
  }, [
    isBalanceMode,
    currentUser,
    balanceOrderId,
    balanceAmountHint,
    balanceOrderOwnerId,
    balanceOrderPath,
  ]);

  // ✅ Load "noteLocked" from the order doc so it stays disabled permanently
  useEffect(() => {
    if (!currentUser) return;
    if (!orderIdForNotes) {
      setNoteLocked(false);
      return;
    }

    (async () => {
      try {
        const ref = doc(db, ...folangeUserOrderPath(currentUser.uid, orderIdForNotes));
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setNoteLocked(false);
          return;
        }

        const data = snap.data() || {};
        const locked =
          !!data?.note?.locked || !!data?.noteLocked || !!data?.noteSent;
        setNoteLocked(locked);
      } catch (e) {
        console.warn("Load note lock failed:", e?.message || e);
        setNoteLocked(false);
      }
    })();
  }, [currentUser, orderIdForNotes]);

  // ✅ Update remaining expiry label live
  useEffect(() => {
    if (!vaExpireAt) {
      setVaRemainingLabel("");
      return;
    }

    const tick = () => {
      const r = getExpiryRemaining(vaExpireAt);
      setVaRemainingLabel(r?.ok ? r.label : "");
    };

    tick();
    const t = setInterval(tick, 15 * 1000);
    return () => clearInterval(t);
  }, [vaExpireAt]);

  const handleAddressSaved = async () => {
    if (!currentUser) return;

    const snap = await getDoc(doc(db, ...folangeUserPath(currentUser.uid)));
    if (snap.exists()) {
      const data = snap.data();
      if (data.shippingAddress) {
        const ensuredAddress = await ensureBvnForUser(
          currentUser.uid,
          data.shippingAddress,
        );
        setShippingAddress(normalizeCheckoutShippingAddress(ensuredAddress));
      }
    }

    setCurrentStep("review");
  };

  const stepIndex = steps.findIndex((s) => s.key === currentStep);
  const progressWidth = `${((stepIndex + 1) / steps.length) * 100}%`;

  // -------------------- Totals --------------------
  const cartTotalAmount =
    cart?.reduce((sum, item) => sum + item.price * item.quantity, 0) || 0;

  const cartShipmentFee =
    shipmentFees?.reduce((sum, item) => {
      const quantity = item.quantity || 1;
      return sum + (item.shipmentFee || 0) * quantity;
    }, 0) || 0;

  const cartGrandTotal = cartTotalAmount + cartShipmentFee;

  const payableBaseAmount = useMemo(() => {
    if (isBalanceMode) return Number(balanceAmount || 0);
    if (isShipmentMode) return Number(shipmentAmount || 0);
    return Number(cartGrandTotal || 0);
  }, [
    isBalanceMode,
    balanceAmount,
    isShipmentMode,
    shipmentAmount,
    cartGrandTotal,
  ]);

  const payableVatAmount = useMemo(
    () => isShipmentMode ? 0 : calcVat(isBalanceMode ? payableBaseAmount : cartTotalAmount),
    [isShipmentMode, isBalanceMode, payableBaseAmount, cartTotalAmount],
  );

  const payableAmount = useMemo(() => {
    const base = Number(payableBaseAmount || 0);
    const vat = Number(payableVatAmount || 0);
    return (
      (Number.isFinite(base) ? base : 0) + (Number.isFinite(vat) ? vat : 0)
    );
  }, [payableBaseAmount, payableVatAmount]);

  const payableLabel = isBalanceMode
    ? "Balance"
    : isShipmentMode
      ? "Shipment Fee"
      : "Grand Total";

  // -------------------- Save note (PERMANENT LOCK per ORDER) --------------------
  const handleSaveNote = async (order = null) => {
    if (!note.trim()) {
      toast.info("Note is optional. Type something to send.");
      return;
    }

    if (!currentUser) {
      toast.error("Please sign in");
      return;
    }

    const orderId = String(order?.id || orderIdForNotes || "").trim();
    if (!orderId) {
      toast.info(
        "Please click Pay Now first to create the order, then you can add an optional note.",
      );
      return;
    }

    if (noteLocked) {
      toast.info("Note already sent for this order.");
      return;
    }

    setSavingNote(true);

    try {
      const uid = currentUser.uid;

      await addDoc(collection(db, ...folangeUserPath(uid), "notes"), {
        note: note.trim(),
        userId: uid,
        userName:
          currentUser?.displayName ||
          currentUser?.name ||
          currentUser?.email ||
          "Guest",
        userEmail: currentUser?.email || "not-provided",
        userRole: currentUser?.role || "user",

        orderId,
        customerName:
          order?.customer?.name ||
          order?.userName ||
          currentUser?.name ||
          "Guest",
        customerPhone: normalizeNgPhoneToLocal(shippingAddress?.phone) || null,

        timestamp: serverTimestamp(),
      });

      await setDoc(
        doc(db, ...folangeUserOrderPath(uid, orderId)),
        {
          updatedAt: serverTimestamp(),
          note: { locked: true, text: note.trim(), sentAt: serverTimestamp() },
          noteLocked: true,
          noteSent: true,
        },
        { merge: true },
      );

      toast.success("Note sent ✅");
      setNote("");
      setNoteLocked(true);
    } catch (error) {
      console.error("Error saving note:", error);
      toast.error(error?.message || "Error sending note. Please try again.");
    } finally {
      setSavingNote(false);
    }
  };

  // ================================
  // CREATE PENDING ORDER (NORMAL CHECKOUT ONLY)
  // ================================
  const createPendingOrder = async ({
    paymentRef,
    meta = {},
    vatRate = VAT_RATE,
    vatCap = VAT_CAP,
  }) => {
    const uid = String(currentUser?.uid || "").trim();
    if (!uid) throw new Error("User not authenticated");

    // Do not clear the previous pending pointer before the replacement order is
    // safely committed. If this write fails, the previous order remains resumable.
    const normalizedCart = (cart || []).map((item, index) => {
      const price = Number(item?.price);
      const quantity = Math.max(1, Number(item?.quantity) || 1);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error(
          `Invalid price for ${item?.name || item?.title || `cart item ${index + 1}`}`,
        );
      }

      const variantsObj = normalizeVariants(item);
      const variantText = variantsObj ? formatVariantsText(variantsObj) : "";

      return sanitizeForFirestore({
        productId: String(item?.id || item?.productId || "").trim(),
        name: item?.name || item?.title || "Item",
        price,
        quantity,
        image: getSafeOrderImage(item?.image),
        category: item?.category || "",
        status: item?.status || "Available",
        ...(variantsObj ? { variants: variantsObj } : {}),
        ...(variantText ? { variantText } : {}),
        ...(item?.sku ? { sku: item.sku } : {}),
      });
    });

    if (!normalizedCart.length) {
      throw new Error("Your cart is empty. No order was created.");
    }

    const totalAmountCalc = normalizedCart.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0,
    );

    const shipmentFeeCalc =
      shipmentFees?.reduce((sum, item) => {
        const quantity = item.quantity || 1;
        return sum + (item.shipmentFee || 0) * quantity;
      }, 0) || 0;

    const payableBaseCalc = totalAmountCalc + shipmentFeeCalc;
    const resolvedVatRate = Number(vatRate);
    const resolvedVatCap = Number(vatCap);
    const safeVatRate = Number.isFinite(resolvedVatRate) ? resolvedVatRate : VAT_RATE;
    const safeVatCap = Number.isFinite(resolvedVatCap) ? resolvedVatCap : VAT_CAP;
    const vatAmountCalc = Math.round(
      Math.min(totalAmountCalc * safeVatRate, safeVatCap),
    );
    const payableTotalCalc = payableBaseCalc + vatAmountCalc;

    const readableAddress = getReadableShippingAddress(shippingAddress || {});
    const customerAddress =
      readableAddress ||
      `${shippingAddress?.address || ""}, ${shippingAddress?.city || ""}, ${shippingAddress?.state || ""}, ${shippingAddress?.country || ""}`.trim();

    const orderData = {
      storeId: FOLANGE_STORE_ID,
      userId: uid,

      customer: {
        name:
          `${shippingAddress?.title || ""} ${shippingAddress?.firstName || ""} ${shippingAddress?.lastName || ""}`.trim() ||
          currentUser.displayName ||
          "Guest User",
        email: shippingAddress?.email || currentUser.email || "unknown",
        phone: normalizeNgPhoneToLocal(shippingAddress?.phone) || "N/A",
        address: customerAddress,
      },

      userEmail: currentUser.email,
      userName: currentUser.displayName || "Guest User",

      cart: normalizedCart,

      shippingAddress: normalizeCheckoutShippingAddress(shippingAddress),

      totalAmount: totalAmountCalc,
      shipmentFee: shipmentFeeCalc,

      grandTotal: payableBaseCalc,

      vat: { rate: safeVatRate, cap: safeVatCap, amount: vatAmountCalc },

      payableTotal: payableTotalCalc,

      // ✅ UNIQUE ORDER (prevents any accidental merge/debug issues)
      orderFingerprint: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      payment: {
        provider: "UBA_VAS",
        reference: paymentRef,
        status: "Pending",
        amount: payableTotalCalc,
        currency: "NGN",
        initiatedAt: serverTimestamp(),
        rawPayload: {
          ...(meta || null),
          vatRate: safeVatRate,
          vatCap: safeVatCap,
          vatAmount: vatAmountCalc,
          payableBase: payableBaseCalc,
          payableTotal: payableTotalCalc,
          vaRequestedType: USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC",
        },
      },

      checkoutState: { pendingVA: true, createdAt: serverTimestamp() },

      orderStatus: "Pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Generate the ID first, then commit the complete order in one acknowledged
    // Firestore write. The UI never receives an order ID from this function
    // unless the order document itself has been accepted by Firestore.
    const orderRef = doc(collection(db, ...folangeUserOrdersPath(uid)));
    const orderPath = getFolangeOrderPath(uid, orderRef.id);
    const completeOrderData = sanitizeForFirestore({
      ...orderData,
      orderPath,
    });

    try {
      await setDoc(orderRef, completeOrderData);
    } catch (error) {
      console.error("ORDER_DOCUMENT_WRITE_FAILED", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
        uid,
        orderId: orderRef.id,
        orderPath,
        itemCount: normalizedCart.length,
      });
      throw error;
    }

    try {
      await setDoc(
        doc(db, ...folangeUserPath(uid)),
        {
          pendingOrderId: orderRef.id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn("Could not persist user.pendingOrderId:", e?.message || e);
    }

    persistPendingCheckoutCache({
      orderId: orderRef.id,
      orderPath,
      mode: "order",
    });

    console.info("ORDER_DOCUMENT_SAVED", {
      orderId: orderRef.id,
      orderPath,
      itemCount: normalizedCart.length,
    });

    // This order was genuinely created by the current checkout page session.
    // Provider retries may reuse it, but restored historical pending orders may not.
    currentCheckoutOrderIdRef.current = orderRef.id;

    return orderRef.id;
  };

  // ================================
  // VAS - BUILD PAYLOAD
  // - STATIC: omit singleDepositLimit + expireAt
  // - DYNAMIC: include singleDepositLimit + expireAt
  // ================================
  const buildVasPayload = (
    addressOverride,
    customerReferenceOverride,
    opts = {},
  ) => {
    const addr = normalizeCheckoutShippingAddress(addressOverride || shippingAddress || {});
    if (!isValidLocalPhone(addr.phone)) {
      throw new Error("Enter an 11-digit shipping phone number starting with 0, e.g. 08034567890.");
    }
    const bvn = addr.bvn || "";

    const firstName =
      addr.firstName || currentUser?.displayName?.split(" ")?.[0] || "Customer";
    const lastName =
      addr.lastName ||
      currentUser?.displayName?.split(" ")?.slice(1).join(" ") ||
      "User";

    const resolvedAccountType = String(
      opts?.accountType || "DYNAMIC",
    ).toUpperCase();

    const payload = {
      bvn,
      firstName,
      lastName,
      middleName: addr.middleName || "",
      accountName: `${firstName} ${lastName}`.trim(),
      email: addr.email || currentUser?.email || "",
      phone: addr.phone || "",
      productType: "FOLANGE",

      // ✅ CRITICAL: send this so backend won't default to DYNAMIC
      accountType: resolvedAccountType,

      customerReference: customerReferenceOverride || addr.phone,

      merchant: { code: process.env.MERCHANT_CODE || "FA9D4" },
    };

    // ✅ DYNAMIC account only when both fields are provided
    if (
      resolvedAccountType !== "STATIC" &&
      opts?.singleDepositLimit != null &&
      opts?.expireAt
    ) {
      payload.singleDepositLimit = String(opts.singleDepositLimit);
      payload.expireAt = String(opts.expireAt);
    }

    if (process.env.VAS_PRODUCT_CODE) {
      payload.meta = { product_code: process.env.VAS_PRODUCT_CODE };
    }

    return payload;
  };

  // ==========================================================
  // ✅ Save VA to ORDER for NORMAL payment
  // ==========================================================
  const saveVaToOrderOrThrow = async ({
    uid,
    orderId,
    payloadCustomerReference,
    paymentRef,
    amount,
    expireAt,
    va,
  }) => {
    const orderDocRef = doc(db, ...folangeUserOrderPath(uid, orderId));

    await setDoc(
      orderDocRef,
      {
        updatedAt: serverTimestamp(),
        orderStatus: "Pending",
        checkoutState: { pendingVA: true, updatedAt: serverTimestamp() },
        payment: {
          provider: "UBA_VAS",
          reference: payloadCustomerReference || orderId,
          paymentRef: paymentRef || null,
          status: "Pending",
          currency: "NGN",
          amount: Number(amount) || 0,

          vaNuban: String(va?.vNUBAN || ""),
          vaAccountName: va?.accountName || null,
          vaType: va?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC"),
          vaExpireAt: expireAt || null,
          vaCreatedAt: va?.createdAt || null,

          vaExpiryMinutes: expireAt ? VA_EXPIRY_MINUTES : null,
          vaRequestedType: USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC",
        },
      },
      { merge: true },
    );

    try {
      await setDoc(
        doc(db, ...folangeUserPath(uid)),
        { pendingOrderId: orderId, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.warn(
        "saveVaToOrderOrThrow user pendingOrderId failed:",
        e?.message || e,
      );
    }

    const check = await getDoc(orderDocRef);
    const saved = check.exists() ? check.data() : null;
    const savedVa = String(saved?.payment?.vaNuban || "").replace(/\D/g, "");

    if (!savedVa) {
      throw new Error(
        "VA was generated but could NOT be saved into the ORDER document. Check Firestore rules for folange/main/users/{uid}/orders/{orderId} update permission.",
      );
    }

    persistPendingCheckoutCache({
      orderId,
      orderPath: getFolangeOrderPath(uid, orderId),
      mode: "order",
      va: {
        vNUBAN: String(va?.vNUBAN || ""),
        accountName: va?.accountName || null,
        type: va?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC"),
        createdAt: va?.createdAt || null,
        expireAt: expireAt || null,
      },
    });
  };

  // ==========================================================
  // ✅ Save VA to ORDER for SHIPMENT payment
  // ==========================================================
  const saveShipmentVaToOrderOrThrow = async ({
    uid,
    orderId,
    orderPathMaybe,
    payloadCustomerReference,
    paymentRef,
    amount,
    expireAt,
    va,
    vatAmount,
  }) => {
    const orderDocRef = doc(db, ...folangeUserOrderPath(uid, orderId));

    await setDoc(
      orderDocRef,
      {
        updatedAt: serverTimestamp(),
        orderPath: getFolangeOrderPath(uid, orderId),
        shipmentPayment: {
          enabled: true,
          amount: Number(amount) || 0,
          vat: { rate: 0, cap: 0, amount: 0 },
          vatExempt: true,
          payableTotal: Number(amount || 0),
          state: "pending",
          payment: {
            provider: "UBA_VAS",
            reference: payloadCustomerReference || `${orderId}-SHIP`,
            paymentRef: paymentRef || null,
            state: "pending",
            currency: "NGN",
            amount: Number(amount || 0),
            initiatedAt: serverTimestamp(),

            vaNuban: String(va?.vNUBAN || ""),
            vaAccountName: va?.accountName || null,
            vaType: va?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC"),
            vaExpireAt: expireAt || null,
            vaCreatedAt: va?.createdAt || null,

            vaExpiryMinutes: expireAt ? VA_EXPIRY_MINUTES : null,
            vaRequestedType: USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC",
          },
        },
      },
      { merge: true },
    );

    const check = await getDoc(orderDocRef);
    const saved = check.exists() ? check.data() : null;
    const savedVa = String(
      saved?.shipmentPayment?.payment?.vaNuban || "",
    ).replace(/\D/g, "");

    if (!savedVa) {
      throw new Error(
        "Shipment VA was generated but could NOT be saved into the ORDER document. Check Firestore rules for shipmentPayment updates.",
      );
    }
  };

  // ==========================================================
  // ✅ Save VA to ORDER for BALANCE payment
  // ==========================================================
  const saveBalanceVaToOrderOrThrow = async ({
    uid,
    orderId,
    orderPathMaybe,
    payloadCustomerReference,
    paymentRef,
    amount,
    expireAt,
    va,
    vatAmount,
  }) => {
    const orderDocRef = doc(db, ...folangeUserOrderPath(uid, orderId));

    await setDoc(
      orderDocRef,
      {
        updatedAt: serverTimestamp(),
        orderPath: getFolangeOrderPath(uid, orderId),
        balancePayment: {
          enabled: true,
          amount: Number(amount) || 0,
          vat: { rate: VAT_RATE, cap: VAT_CAP, amount: Number(vatAmount) || 0 },
          payableTotal: Number(amount || 0) + Number(vatAmount || 0),
          state: "pending",
          payment: {
            provider: "UBA_VAS",
            reference: payloadCustomerReference || `${orderId}-BAL`,
            paymentRef: paymentRef || null,
            state: "pending",
            currency: "NGN",
            amount: Number(amount || 0) + Number(vatAmount || 0),
            initiatedAt: serverTimestamp(),

            vaNuban: String(va?.vNUBAN || ""),
            vaAccountName: va?.accountName || null,
            vaType: va?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC"),
            vaExpireAt: expireAt || null,
            vaCreatedAt: va?.createdAt || null,

            vaExpiryMinutes: expireAt ? VA_EXPIRY_MINUTES : null,
            vaRequestedType: USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC",
          },
        },
      },
      { merge: true },
    );

    const check = await getDoc(orderDocRef);
    const saved = check.exists() ? check.data() : null;
    const savedVa = String(
      saved?.balancePayment?.payment?.vaNuban || "",
    ).replace(/\D/g, "");

    if (!savedVa) {
      throw new Error(
        "Balance VA was generated but could NOT be saved into the ORDER document. Check Firestore rules for balancePayment updates.",
      );
    }
  };

  // ================================
  // VAS - CREATE DYNAMIC VA PER ORDER
  // ================================
  const createDynamicVirtualAccountForOrder = async (
    addressOverride,
    orderId,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const amount = Number(amountToPay || 0);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Invalid amount. Please try again.");

    const expireAt = formatExpireAtWithOffset(
      new Date(Date.now() + VA_EXPIRY_MINUTES * 60 * 1000),
    );

    const payload = buildVasPayload(addressOverride, orderId, {
      accountType: "DYNAMIC",
      singleDepositLimit: amount,
      expireAt,
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in VA payload:", payload.bvn);
      throw new Error("Unable to generate virtual account. Please try again.");
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get virtual account number. Please try again.",
      );

    await saveVaToOrderOrThrow({
      uid: currentUser.uid,
      orderId,
      payloadCustomerReference: payload?.customerReference || orderId,
      paymentRef,
      amount,
      expireAt,
      va,
    });

    return { ...va, expireAt };
  };

  const createShipmentVirtualAccountForExistingOrder = async (
    addressOverride,
    orderId,
    orderPathMaybe,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const payableBase = Number(amountToPay || 0);
    if (!Number.isFinite(payableBase) || payableBase <= 0)
      throw new Error("Invalid shipment amount. Please try again.");

    const vatAmount = 0; // Shipment fees are exempt from VAT.
    const amountWithVat = payableBase + vatAmount;

    const expireAt = formatExpireAtWithOffset(
      new Date(Date.now() + VA_EXPIRY_MINUTES * 60 * 1000),
    );
    const shipmentRef = `${orderId}-SHIP`;

    const payload = buildVasPayload(addressOverride, shipmentRef, {
      accountType: "DYNAMIC",
      singleDepositLimit: amountWithVat,
      expireAt,
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in shipment VA payload:", payload.bvn);
      throw new Error(
        "Unable to generate shipment virtual account. Please try again.",
      );
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get shipment virtual account number. Please try again.",
      );

    await saveShipmentVaToOrderOrThrow({
      uid: shipmentOrderOwnerId,
      orderId,
      orderPathMaybe,
      payloadCustomerReference: payload?.customerReference || shipmentRef,
      paymentRef,
      amount: payableBase,
      vatAmount,
      expireAt,
      va,
    });

    return { ...va, expireAt };
  };

  const createBalanceVirtualAccountForExistingOrder = async (
    addressOverride,
    orderId,
    orderPathMaybe,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const payableBase = Number(amountToPay || 0);
    if (!Number.isFinite(payableBase) || payableBase <= 0)
      throw new Error("Invalid balance amount. Please try again.");

    const vatAmount = calcVat(payableBase);
    const amountWithVat = payableBase + vatAmount;

    const expireAt = formatExpireAtWithOffset(
      new Date(Date.now() + VA_EXPIRY_MINUTES * 60 * 1000),
    );
    const balanceRef = `${orderId}-BAL`;

    const payload = buildVasPayload(addressOverride, balanceRef, {
      accountType: "DYNAMIC",
      singleDepositLimit: amountWithVat,
      expireAt,
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in balance VA payload:", payload.bvn);
      throw new Error(
        "Unable to generate balance virtual account. Please try again.",
      );
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get balance virtual account number. Please try again.",
      );

    await saveBalanceVaToOrderOrThrow({
      uid: balanceOrderOwnerId,
      orderId,
      orderPathMaybe,
      payloadCustomerReference: payload?.customerReference || balanceRef,
      paymentRef,
      amount: payableBase,
      vatAmount,
      expireAt,
      va,
    });

    return { ...va, expireAt };
  };

  // ================================
  // VAS - CREATE STATIC VAs
  // ================================
  const createStaticVirtualAccountForOrder = async (
    addressOverride,
    orderId,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const amount = Number(amountToPay || 0);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Invalid amount. Please try again.");

    const payload = buildVasPayload(addressOverride, orderId, {
      accountType: "STATIC",
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in STATIC VA payload:", payload.bvn);
      throw new Error("Unable to generate virtual account. Please try again.");
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get static virtual account number. Please try again.",
      );

    await saveVaToOrderOrThrow({
      uid: currentUser.uid,
      orderId,
      payloadCustomerReference: payload?.customerReference || orderId,
      paymentRef,
      amount,
      expireAt: null,
      va,
    });

    return { ...va, expireAt: null };
  };

  const createStaticShipmentVirtualAccountForExistingOrder = async (
    addressOverride,
    orderId,
    orderPathMaybe,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const payableBase = Number(amountToPay || 0);
    if (!Number.isFinite(payableBase) || payableBase <= 0)
      throw new Error("Invalid shipment amount. Please try again.");

    const vatAmount = 0; // Shipment fees are exempt from VAT.
    const shipmentRef = `${orderId}-SHIP`;

    const payload = buildVasPayload(addressOverride, shipmentRef, {
      accountType: "STATIC",
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in STATIC shipment VA payload:", payload.bvn);
      throw new Error(
        "Unable to generate shipment virtual account. Please try again.",
      );
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get shipment virtual account number. Please try again.",
      );

    await saveShipmentVaToOrderOrThrow({
      uid: shipmentOrderOwnerId,
      orderId,
      orderPathMaybe,
      payloadCustomerReference: payload?.customerReference || shipmentRef,
      paymentRef,
      amount: payableBase,
      vatAmount,
      expireAt: null,
      va,
    });

    return { ...va, expireAt: null };
  };

  const createStaticBalanceVirtualAccountForExistingOrder = async (
    addressOverride,
    orderId,
    orderPathMaybe,
    paymentRef,
    amountToPay,
  ) => {
    if (!currentUser) throw new Error("Please sign in first.");

    const payableBase = Number(amountToPay || 0);
    if (!Number.isFinite(payableBase) || payableBase <= 0)
      throw new Error("Invalid balance amount. Please try again.");

    const vatAmount = calcVat(payableBase);
    const balanceRef = `${orderId}-BAL`;

    const payload = buildVasPayload(addressOverride, balanceRef, {
      accountType: "STATIC",
    });

    if (!payload.bvn || !/^\d{11}$/.test(String(payload.bvn))) {
      console.error("Invalid BVN in STATIC balance VA payload:", payload.bvn);
      throw new Error(
        "Unable to generate balance virtual account. Please try again.",
      );
    }

    const response = await createVirtualAccount(payload);
    const va = response?.data?.provider_response?.virtualAccount;

    if (!va?.vNUBAN)
      throw new Error(
        "Unable to get balance virtual account number. Please try again.",
      );

    await saveBalanceVaToOrderOrThrow({
      uid: balanceOrderOwnerId,
      orderId,
      orderPathMaybe,
      payloadCustomerReference: payload?.customerReference || balanceRef,
      paymentRef,
      amount: payableBase,
      vatAmount,
      expireAt: null,
      va,
    });

    return { ...va, expireAt: null };
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Copy failed", err);
      toast.error("Copy failed");
    }
  };

  const normalizePaymentMode = (mode) =>
    mode === "shipment" ? "shipment" : mode === "balance" ? "balance" : "order";

  const openThankYouModal = ({ amount, mode, orderId, provider = "", partial = false, outstanding = 0, orderPath = "", userId = "" }) => {
    const normalizedMode = normalizePaymentMode(mode);
    const normalizedOrderId = String(orderId || "").trim();
    const normalizedAmount = Number(amount) || 0;

    setShowVAModal(false);
    setShowPaymentFailureModal(false);
    setPaystackTransition(null);

    const payload = {
      status: "success",
      provider,
      partial: Boolean(partial),
      outstanding: Math.max(0, Number(outstanding) || 0),
      orderPath,
      userId,
      amount: normalizedAmount,
      mode: normalizedMode,
      orderId: normalizedOrderId,
    };

    setThankYouData(payload);
    persistPaymentResultCache(payload);
    setShowThankYouModal(true);
  };

  const openPaymentFailureModal = ({ amount, mode, orderId, message }) => {
    const normalizedMode = normalizePaymentMode(mode);
    const normalizedOrderId = String(orderId || "").trim();
    const normalizedAmount = Number(amount) || 0;

    setShowVAModal(false);
    setShowThankYouModal(false);

    const payload = {
      status: "failure",
      amount: normalizedAmount,
      mode: normalizedMode,
      orderId: normalizedOrderId,
      message: message || "Payment was not confirmed.",
    };

    setPaymentFailureData(payload);
    persistPaymentResultCache(payload);
    setShowPaymentFailureModal(true);
  };

  const handleThankYouOk = () => {
    setShowThankYouModal(false);
    persistPaymentResultCache(null);

    if (thankYouData?.partial) {
      // Continue against this same order, rather than creating another sale.
      const mode = thankYouData.mode === "shipment" ? "shipment" : "balance";
      const params = new URLSearchParams({
        mode,
        orderId: thankYouData.orderId,
        amount: String(thankYouData.outstanding || 0),
        ...(normalizeFolangeOrderPath(thankYouData.orderPath) ? { orderPath: normalizeFolangeOrderPath(thankYouData.orderPath) } : {}),
        ...(thankYouData.userId ? { userId: thankYouData.userId } : {}),
      });
      setCurrentStep("payment");
      navigate({ pathname: location.pathname, search: `?${params.toString()}` }, {
        state: { ...thankYouData, mode, amount: thankYouData.outstanding },
      });
      return;
    }

    try {
      if (typeof clearShipmentFees === "function") clearShipmentFees();
    } catch {}

    navigate("/");
  };

  const handlePaymentFailureOk = () => {
    setShowPaymentFailureModal(false);
    persistPaymentResultCache(null);
    navigate("/");
  };

  // ✅ Optional cancel pending payment session (keeps order history, clears resume state)
  const handleCancelPendingPayment = async () => {
    try {
      const orderIdToCancel = isBalanceMode
        ? balanceOrderId
        : isShipmentMode
          ? shipmentOrderId
          : pendingOrderId;

      if (!isPaymentOnlyMode) {
        await clearPendingPaymentPersistence({
          orderId: orderIdToCancel,
          keepOrderDoc: false,
        });
      }

      setVirtualAccount(null);
      setVaExpireAt(null);
      setShowVAModal(false);

      if (!isPaymentOnlyMode) {
        setPendingOrderId(null);
        setPendingRestored(false);
        setCurrentStep(shippingAddress ? "review" : "shipping");
        openPaymentFailureModal({
          amount: payableAmount,
          mode: getPaymentModeForCurrentPage(),
          orderId: orderIdToCancel,
          message: "Payment session was cancelled before confirmation.",
        });
      } else {
        toast.info("Payment session closed.");
      }
    } catch (e) {
      console.error("Cancel pending payment failed:", e);
      toast.error("Unable to cancel pending payment session");
    }
  };

  // ================================
  // PAYSTACK VERIFIED INFLOW HELPERS
  // A Paystack part payment is a successful payment event even when the
  // obligation is not fully paid yet.
  // ================================
  const getPaystackVerifiedPaidInfo = (order, mode) => {
    const payment =
      mode === "shipment"
        ? order?.shipmentPayment?.payment || {}
        : mode === "balance"
          ? order?.balancePayment?.payment || {}
          : order?.payment || {};

    const parent =
      mode === "shipment"
        ? order?.shipmentPayment || {}
        : mode === "balance"
          ? order?.balancePayment || {}
          : {};

    const inflow = payment?.inflow || {};

    const paidCandidates = [
      payment?.amountPaid,
      inflow?.paidTotal,
      inflow?.amountPaid,
      inflow?.["amount paid"],
      inflow?.amount,
      parent?.amountPaid,
    ]
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value >= 0);

    const paidTotal = paidCandidates.length ? Math.max(...paidCandidates) : 0;

    const outstandingCandidates = [
      payment?.outstanding,
      inflow?.outstanding,
      parent?.outstanding,
    ]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);

    const obligationCandidates = [
      mode === "order" ? order?.payableTotal : null,
      parent?.payableTotal,
      parent?.amount,
      payment?.amount,
      inflow?.expected,
    ]
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    const obligationTotal = mode === "shipment"
      ? Math.max(0, Number(parent?.amount ?? parent?.baseAmount ?? order?.shipment?.fee ?? order?.shipmentFee ?? 0) || 0)
      : obligationCandidates.length ? Math.max(...obligationCandidates) : 0;

    const outstanding = mode === "shipment"
      ? Math.max(0, obligationTotal - paidTotal)
      : outstandingCandidates.length
        ? Math.min(...outstandingCandidates)
        : Math.max(0, obligationTotal - paidTotal);

    const state = String(
      payment?.state ||
        payment?.status ||
        parent?.state ||
        (mode === "order" ? order?.orderStatus : "") ||
        "",
    ).toLowerCase();

    const provider = String(
      payment?.provider || inflow?.provider || "",
    ).toUpperCase();

    const hasVerifiedPaystackInflow =
      provider === "PAYSTACK_DVA" &&
      paidTotal > 0 &&
      (
        String(inflow?.provider || "").toUpperCase() === "PAYSTACK_DVA" ||
        String(inflow?.source || "").toLowerCase() === "paystack-webhook" ||
        !!inflow?.transactionReference ||
        !!inflow?.transactionId ||
        !!payment?.paystackVerified
      );

    const fullyPaid =
      state === "paid" ||
      !!payment?.paidAt ||
      (obligationTotal > 0 && outstanding <= 0);

    return {
      payment,
      provider,
      paidTotal,
      outstanding,
      obligationTotal,
      state,
      hasVerifiedPaystackInflow,
      fullyPaid,
    };
  };

  const finishPaystackVerifiedAttempt = async ({
    order,
    orderId,
    mode,
    manual = false,
  }) => {
    const info = getPaystackVerifiedPaidInfo(order, mode);

    if (!info.hasVerifiedPaystackInflow) return false;

    // Close only the current Paystack account/payment-attempt UI.
    // A PARTIAL order must remain resumable for another payment later.
    setShowVAModal(false);
    setVirtualAccount(null);
    setVaExpireAt(null);
    setActivePaymentProvider("");
    setPaystackSelectedAmount(0);
    setPaystackPartAmount("");

    if (info.fullyPaid) {
      if (!isPaymentOnlyMode) {
        await clearPendingPaymentPersistence({
          orderId,
          keepOrderDoc: false,
        });
        setPendingOrderId(null);
        setPendingRestored(false);
        safeClearCart();
      }

      if (
        mode === "shipment" &&
        typeof setShipmentFeeStatusPayment === "function"
      ) {
        try {
          setShipmentFeeStatusPayment(true);
        } catch {}
      }

      openThankYouModal({
        amount: info.paidTotal || info.obligationTotal || payableAmount,
        mode,
        orderId,
        provider: "PAYSTACK_DVA",
      });

      return true;
    }

    // PARTIAL PAYMENT:
    // Keep the order/cart/pending pointer. The customer has successfully paid
    // this attempt, but there is still an outstanding balance.
    if (!isPaymentOnlyMode) {
      setPendingOrderId(orderId);
      setPendingRestored(true);
      setCurrentStep("payment");

      persistPendingCheckoutCache({
        orderId,
        orderPath:
          normalizeFolangeOrderPath(order?.orderPath) ||
          getFolangeOrderPath(currentUser?.uid || "", orderId),
        mode,
      });
    }

    // Refresh payment-only docs so another payment uses the new outstanding.
    if (mode === "shipment") {
      setShipmentOrderDoc((current) => ({
        ...(current || {}),
        ...order,
        id: orderId,
      }));
      setShipmentAmount(info.outstanding);
    }

    if (mode === "balance") {
      setBalanceOrderDoc((current) => ({
        ...(current || {}),
        ...order,
        id: orderId,
      }));
      setBalanceAmount(info.outstanding);
    }

    openThankYouModal({
      amount: info.paidTotal,
      mode,
      orderId,
      provider: "PAYSTACK_DVA",
      partial: true,
      outstanding: info.outstanding,
      userId: order?.userId || (mode === "shipment" ? shipmentOrderOwnerId :
        mode === "balance" ? balanceOrderOwnerId : currentUser?.uid) || "",
      orderPath: normalizeFolangeOrderPath(order?.orderPath) || "",
    });

    return true;
  };

  // ================================
  // RECONCILE PAYMENT (supports shipment + balance)
  // ================================
  const reconcileOrderPayment = async () => {
    try {
      const uid = isBalanceMode
        ? balanceOrderOwnerId
        : isShipmentMode
          ? shipmentOrderOwnerId
          : currentUser?.uid;

      const orderIdToCheck = isBalanceMode
        ? balanceOrderId
        : isShipmentMode
          ? shipmentOrderId
          : pendingOrderId;

      if (!uid || !orderIdToCheck) {
        toast.error("Missing order info");
        return;
      }

      setReconLoading(true);

      const orderRef = doc(db, ...folangeUserOrderPath(uid, orderIdToCheck));
      const snap = await getDoc(orderRef);

      if (!snap.exists()) {
        toast.error("Order not found");
        return;
      }

      const order = snap.data() || {};
      const orderPath =
        normalizeFolangeOrderPath(order?.orderPath) || getFolangeOrderPath(uid, orderIdToCheck);

      const mode = isBalanceMode
        ? "balance"
        : isShipmentMode
          ? "shipment"
          : "order";
      const selectedPayment =
        getPaystackPaymentFromOrder(order, mode);
      const selectedProvider = String(
        selectedPayment?.provider || activePaymentProvider || "",
      ).toUpperCase();

      // Paystack is webhook-driven. Never call the UBA query-inflow
      // endpoint for a Paystack DVA. A verified PARTIAL inflow is also a
      // successful payment attempt and must transition the Checkout UI.
      if (selectedProvider === "PAYSTACK_DVA") {
        const handled = await finishPaystackVerifiedAttempt({
          order,
          orderId: orderIdToCheck,
          mode,
          manual: true,
        });

        if (!handled) {
          setPaystackTransition({
            status: "waiting",
            message: "Paystack has not confirmed this transfer yet. Your account remains open; confirmation will appear here when received.",
          });
        }

        return;
      }

      let vNUBAN = "";

      // 1) balance VA
      if (isBalanceMode) {
        vNUBAN = String(
          order?.balancePayment?.payment?.vaNuban ||
            order?.balancePayment?.payment?.vaNUBAN ||
            order?.balancePayment?.payment?.vNUBAN ||
            "",
        ).replace(/\D/g, "");
      }

      // 2) shipment VA
      if (!vNUBAN && isShipmentMode) {
        vNUBAN = String(
          order?.shipmentPayment?.payment?.vaNuban ||
            order?.shipmentPayment?.payment?.vaNUBAN ||
            order?.shipmentPayment?.payment?.vNUBAN ||
            "",
        ).replace(/\D/g, "");
      }

      // 3) normal payment VA
      if (!vNUBAN) {
        vNUBAN = String(
          order?.payment?.vaNuban ||
            order?.payment?.vaNUBAN ||
            order?.payment?.vNUBAN ||
            order?.payment?.vNuban ||
            order?.payment?.rawPayload?.vaNuban ||
            order?.payment?.rawPayload?.vaNUBAN ||
            order?.payment?.rawPayload?.vNUBAN ||
            "",
        ).replace(/\D/g, "");
      }

      // 4) fallback
      if (!vNUBAN) {
        vNUBAN = String(
          order?.vasVirtualAccount?.vNUBAN ||
            order?.vasVirtualAccount?.vaNuban ||
            virtualAccount?.vNUBAN ||
            virtualAccount?.vaNuban ||
            "",
        ).replace(/\D/g, "");
      }

      if (!vNUBAN) {
        toast.error("No virtual account number found on this order yet");
        return;
      }

      const today = new Date();
      const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      const startDate = formatYyyyMmDd(start);
      const endDate = formatYyyyMmDd(today);

      const res = await fetch("/.netlify/functions/query-inflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vNUBAN,
          storeId: FOLANGE_STORE_ID,
          orderPath: getFolangeOrderPath(uid, orderIdToCheck),
          startDate,
          endDate,
          markPaid: true,
          userId: uid,
          orderId: orderIdToCheck,
          mode,
          paymentReference,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (data?.ok && (data?.updated?.paid === true || data?.paid === true)) {
        if (!isPaymentOnlyMode) {
          await clearPendingPaymentPersistence({
            orderId: orderIdToCheck,
            keepOrderDoc: false,
          });
          setPendingOrderId(null);
          setVirtualAccount(null);
          setVaExpireAt(null);
          setPendingRestored(false);
          safeClearCart();
        }

        if (
          isShipmentMode &&
          typeof setShipmentFeeStatusPayment === "function"
        ) {
          try {
            setShipmentFeeStatusPayment(true);
          } catch {}
        }

        const amountFromRes =
          Number(
            data?.updated?.amount ??
              data?.amount ??
              data?.successful?.[0]?.amount,
          ) || null;

        openThankYouModal({
          amount: amountFromRes != null ? amountFromRes : payableAmount,
          mode,
          orderId: orderIdToCheck,
        });

        return;
      }

      if (
        data?.ok &&
        (data?.successfulCount === 0 || data?.updated?.paid === false)
      ) {
        toast.info("No successful inflow yet. Try again in 1–2 minutes.");
        return;
      }

      toast.error(data?.message || "Reconcile failed");
    } catch (e) {
      console.error("Reconcile error:", e);
      if (activePaymentProvider === "PAYSTACK_DVA") {
        showPaystackError(e?.message || "Unable to check Paystack confirmation.");
      } else {
        toast.error(e?.message || "Reconcile failed");
      }
    } finally {
      setReconLoading(false);
    }
  };

  // ================================
  // AUTO PAYMENT POLLING - SILENT CHECK
  // ✅ Does not toast "No inflow yet"
  // ✅ Does not clear cart while still checking
  // ✅ Opens success modal once query-inflow confirms paid/partial inflow
  // ================================
  const silentAutoReconcilePayment = async () => {
    const uid = currentUser?.uid;

    const orderIdToCheck = isBalanceMode
      ? balanceOrderId
      : isShipmentMode
        ? shipmentOrderId
        : pendingOrderId;

    if (!uid || !orderIdToCheck) return false;

    try {
      const orderRef = doc(db, ...folangeUserOrderPath(uid, orderIdToCheck));
      const snap = await getDoc(orderRef);

      if (!snap.exists()) return false;

      const order = snap.data() || {};
      const orderPath =
        normalizeFolangeOrderPath(order?.orderPath) || getFolangeOrderPath(uid, orderIdToCheck);

      const mode = isBalanceMode
        ? "balance"
        : isShipmentMode
          ? "shipment"
          : "order";

      // ✅ If Firestore was already updated by webhook or another check, treat as success.
      const mainPaid =
        String(order?.orderStatus || "").toLowerCase() === "paid" ||
        String(order?.payment?.status || "").toLowerCase() === "paid" ||
        !!order?.payment?.paidAt;

      const shipmentPaid =
        String(order?.shipmentPayment?.state || "").toLowerCase() === "paid" ||
        String(order?.shipmentPayment?.payment?.state || "").toLowerCase() ===
          "paid" ||
        !!order?.shipmentPayment?.paidAt;

      const balancePaid =
        String(order?.balancePayment?.state || "").toLowerCase() === "paid" ||
        String(order?.balancePayment?.payment?.state || "").toLowerCase() ===
          "paid" ||
        !!order?.balancePayment?.paidAt;

      const alreadyPaidForThisMode = isBalanceMode
        ? balancePaid
        : isShipmentMode
          ? shipmentPaid
          : mainPaid;

      if (alreadyPaidForThisMode) {
        if (!isPaymentOnlyMode) {
          await clearPendingPaymentPersistence({
            orderId: orderIdToCheck,
            keepOrderDoc: false,
          });
          setPendingOrderId(null);
          setVirtualAccount(null);
          setVaExpireAt(null);
          setPendingRestored(false);
          safeClearCart();
        }

        if (
          isShipmentMode &&
          typeof setShipmentFeeStatusPayment === "function"
        ) {
          try {
            setShipmentFeeStatusPayment(true);
          } catch {}
        }

        openThankYouModal({
          amount: payableAmount,
          mode,
          orderId: orderIdToCheck,
        });

        return true;
      }

      const selectedPayment =
        getPaystackPaymentFromOrder(order, mode);
      const selectedProvider = String(
        selectedPayment?.provider || activePaymentProvider || "",
      ).toUpperCase();

      // Paystack payment confirmation comes from the signed webhook.
      // A verified partial inflow must also end the current payment attempt.
      if (selectedProvider === "PAYSTACK_DVA") {
        return await finishPaystackVerifiedAttempt({
          order,
          orderId: orderIdToCheck,
          mode,
          manual: false,
        });
      }


      let vNUBAN = "";
      let referenceToSend = "";

      if (isBalanceMode) {
        vNUBAN = String(
          order?.balancePayment?.payment?.vaNuban ||
            order?.balancePayment?.payment?.vaNUBAN ||
            order?.balancePayment?.payment?.vNUBAN ||
            "",
        ).replace(/\D/g, "");

        referenceToSend = String(
          order?.balancePayment?.payment?.reference ||
            order?.balancePayment?.payment?.paymentRef ||
            `${orderIdToCheck}-BAL`,
        ).trim();
      }

      if (!vNUBAN && isShipmentMode) {
        vNUBAN = String(
          order?.shipmentPayment?.payment?.vaNuban ||
            order?.shipmentPayment?.payment?.vaNUBAN ||
            order?.shipmentPayment?.payment?.vNUBAN ||
            "",
        ).replace(/\D/g, "");

        referenceToSend = String(
          order?.shipmentPayment?.payment?.reference ||
            order?.shipmentPayment?.payment?.paymentRef ||
            `${orderIdToCheck}-SHIP`,
        ).trim();
      }

      if (!vNUBAN) {
        vNUBAN = String(
          order?.payment?.vaNuban ||
            order?.payment?.vaNUBAN ||
            order?.payment?.vNUBAN ||
            order?.payment?.vNuban ||
            order?.payment?.rawPayload?.vaNuban ||
            order?.payment?.rawPayload?.vaNUBAN ||
            order?.payment?.rawPayload?.vNUBAN ||
            "",
        ).replace(/\D/g, "");

        referenceToSend = String(
          order?.payment?.reference ||
            order?.payment?.paymentRef ||
            paymentReference ||
            orderIdToCheck,
        ).trim();
      }

      if (!vNUBAN) {
        vNUBAN = String(
          order?.vasVirtualAccount?.vNUBAN ||
            order?.vasVirtualAccount?.vaNuban ||
            virtualAccount?.vNUBAN ||
            virtualAccount?.vaNuban ||
            "",
        ).replace(/\D/g, "");
      }

      if (!vNUBAN) return false;

      const today = new Date();
      const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      const res = await fetch("/.netlify/functions/query-inflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vNUBAN,
          vaNuban: vNUBAN,
          storeId: FOLANGE_STORE_ID,
          orderPath: getFolangeOrderPath(uid, orderIdToCheck),
          startDate: formatYyyyMmDd(start),
          endDate: formatYyyyMmDd(today),
          markPaid: true,
          userId: uid,
          orderId: orderIdToCheck,
          mode,
          paymentReference: referenceToSend,
          reference: referenceToSend,
          customerReference: referenceToSend,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const successfulArr = Array.isArray(data?.successful)
        ? data.successful
        : Array.isArray(data?.successfulInflows)
          ? data.successfulInflows
          : [];

      const successState = String(data?.updated?.state || "").toLowerCase();
      const hasConfirmedInflow =
        data?.ok &&
        (data?.updated?.paid === true ||
          data?.paid === true ||
          successState === "paid" ||
          successState === "partial" ||
          successfulArr.length > 0);

      if (!hasConfirmedInflow) return false;

      if (!isPaymentOnlyMode) {
        await clearPendingPaymentPersistence({
          orderId: orderIdToCheck,
          keepOrderDoc: false,
        });
        setPendingOrderId(null);
        setVirtualAccount(null);
        setVaExpireAt(null);
        setPendingRestored(false);
        safeClearCart();
      }

      if (isShipmentMode && typeof setShipmentFeeStatusPayment === "function") {
        try {
          setShipmentFeeStatusPayment(true);
        } catch {}
      }

      const amountFromRes =
        Number(
          data?.updated?.paidTotal ??
            data?.updated?.amount ??
            data?.amount ??
            successfulArr?.[0]?.amount,
        ) || null;

      openThankYouModal({
        amount: amountFromRes != null ? amountFromRes : payableAmount,
        mode,
        orderId: orderIdToCheck,
      });

      return true;
    } catch (e) {
      console.warn("Silent auto payment check failed:", e?.message || e);
      return false;
    }
  };

  // ================================
  // PAYSTACK SERVER CONFIRMATION
  // ================================
  // Paystack's signed webhook writes the verified result to the order document.
  // Poll that exact document through REST every 5 seconds. This avoids the
  // regular SDK watch stream while still confirming signed-webhook results.
  // Returning to the tab triggers an immediate check.
  useEffect(() => {
    const orderIdToWatch = isBalanceMode
      ? balanceOrderId
      : isShipmentMode
        ? shipmentOrderId
        : pendingOrderId;

    if (
      activePaymentProvider !== "PAYSTACK_DVA" ||
      !showVAModal ||
      !currentUser ||
      !orderIdToWatch
    ) {
      return undefined;
    }

    const mode = getPaymentModeForCurrentPage();
    const ownerId =
      mode === "balance"
        ? balanceOrderOwnerId
        : mode === "shipment"
          ? shipmentOrderOwnerId
          : currentUser.uid;

    const orderRef = doc(db, ...folangeUserOrderPath(ownerId, orderIdToWatch));

    let handlingVerifiedPayment = false;

    const stopPolling = pollCheckoutDocument({
      ref: orderRef,
      intervalMs: PAYSTACK_CONFIRMATION_POLL_MS,
      onData: async (snap) => {
        if (!snap.exists() || handlingVerifiedPayment) return;

        const order = {
          id: orderIdToWatch,
          ...snap.data(),
          userId: snap.data()?.userId || ownerId,
          orderPath:
            normalizeFolangeOrderPath(snap.data()?.orderPath) ||
            getFolangeOrderPath(ownerId, orderIdToWatch),
        };

        const info = getPaystackVerifiedPaidInfo(order, mode);

        if (!info.hasVerifiedPaystackInflow) return;

        handlingVerifiedPayment = true;

        try {
          await finishPaystackVerifiedAttempt({
            order,
            orderId: orderIdToWatch,
            mode,
            manual: false,
          });
        } catch (error) {
          handlingVerifiedPayment = false;
          console.error(
            "Paystack transition failed:",
            error?.message || error,
          );
        }
      },
      onError: (error) => {
        console.error(
          "Paystack confirmation check failed:",
          error?.message || error,
        );
        // A failed read is not a failed payment. Keep checking after recovery.
      },
    });

    return () => stopPolling();
  }, [
    activePaymentProvider,
    showVAModal,
    currentUser?.uid,
    pendingOrderId,
    shipmentOrderId,
    balanceOrderId,
    isShipmentMode,
    isBalanceMode,
    shipmentOrderOwnerId,
    balanceOrderOwnerId,
  ]);

  // ================================
  // AUTO PAYMENT POLLING TIMER
  // ✅ Poll every 10 seconds while the payment modal is open.
  // ✅ After 2 minutes, ask if customer is still making payment.
  // ✅ IMPORTANT: do NOT clear the pending order just because the customer delayed.
  // Customer may close the browser, make transfer, then return later.
  // ================================
  useEffect(() => {
    const orderIdToWatch = isBalanceMode
      ? balanceOrderId
      : isShipmentMode
        ? shipmentOrderId
        : pendingOrderId;

    if (
      activePaymentProvider !== "UBA_VAS" ||
      !showVAModal ||
      !virtualAccount?.vNUBAN ||
      !currentUser ||
      !orderIdToWatch
    ) {
      return undefined;
    }

    const stopAutoPolling = () => {
      autoPaymentPollStoppedRef.current = true;
      if (autoPaymentPollTimerRef.current) {
        clearInterval(autoPaymentPollTimerRef.current);
        autoPaymentPollTimerRef.current = null;
      }
    };

    const pauseAutoPollingWithoutClearing = () => {
      stopAutoPolling();
      toast.info(
        "Payment has not been confirmed yet. You can close this page and come back later; your payment session is saved.",
      );
    };

    autoPaymentPollStoppedRef.current = false;
    autoPaymentPollInFlightRef.current = false;
    autoPaymentPollPromptOpenRef.current = false;
    autoPaymentPollRoundRef.current = 1;
    autoPaymentPollStartRef.current = Date.now();

    const runAutoPoll = async () => {
      if (autoPaymentPollStoppedRef.current) return;
      if (autoPaymentPollInFlightRef.current) return;

      const elapsedMs = Date.now() - autoPaymentPollStartRef.current;

      if (elapsedMs >= 2 * 60 * 1000) {
        if (autoPaymentPollRoundRef.current === 1) {
          if (autoPaymentPollPromptOpenRef.current) return;
          autoPaymentPollPromptOpenRef.current = true;

          stopAutoPolling();

          const keepWaiting = window.confirm(
            "We have not confirmed your payment yet. Are you still making the payment? Click OK to keep checking for another 2 minutes, or Cancel to stop.",
          );

          autoPaymentPollPromptOpenRef.current = false;

          if (keepWaiting) {
            autoPaymentPollStoppedRef.current = false;
            autoPaymentPollRoundRef.current = 2;
            autoPaymentPollStartRef.current = Date.now();
            autoPaymentPollTimerRef.current = setInterval(
              runAutoPoll,
              10 * 1000,
            );
            return;
          }

          pauseAutoPollingWithoutClearing();
          return;
        }

        pauseAutoPollingWithoutClearing();
        return;
      }

      autoPaymentPollInFlightRef.current = true;
      const paid = await silentAutoReconcilePayment();
      autoPaymentPollInFlightRef.current = false;

      if (paid) {
        stopAutoPolling();
      }
    };

    autoPaymentPollTimerRef.current = setInterval(runAutoPoll, 10 * 1000);

    return () => {
      stopAutoPolling();
    };
  }, [
    showVAModal,
    virtualAccount?.vNUBAN,
    currentUser,
    pendingOrderId,
    shipmentOrderId,
    balanceOrderId,
    isShipmentMode,
    isBalanceMode,
    isPaymentOnlyMode,
    paymentReference,
    payableAmount,
    navigate,
  ]);

  // ================================
  // ✅ RELOAD RESUME CHECK
  // When customer closes the site to make a transfer and later reloads,
  // immediately check the saved pending order and show success/failure/pending.
  // ================================
  useEffect(() => {
    const orderIdToCheck = isBalanceMode
      ? balanceOrderId
      : isShipmentMode
        ? shipmentOrderId
        : pendingOrderId;

    if (!currentUser) return;

    // 1) Show last saved success/failure result after reload until customer closes it.
    try {
      const raw = localStorage.getItem(
        getCheckoutPaymentResultCacheKey(currentUser.uid),
      );
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.status === "success") {
          setThankYouData({
            amount: Number(cached?.amount || 0),
            provider: String(cached?.provider || ""),
            partial: Boolean(cached?.partial),
            outstanding: Math.max(0, Number(cached?.outstanding) || 0),
            orderPath: String(normalizeFolangeOrderPath(cached?.orderPath) || ""),
            userId: String(cached?.userId || ""),
            mode: normalizePaymentMode(cached?.mode),
            orderId: String(cached?.orderId || ""),
          });
          setShowVAModal(false);
          setShowPaymentFailureModal(false);
          setShowThankYouModal(true);
          return;
        }
        if (cached?.status === "failure") {
          setPaymentFailureData({
            amount: Number(cached?.amount || 0),
            mode: normalizePaymentMode(cached?.mode),
            orderId: String(cached?.orderId || ""),
            message: cached?.message || "Payment was not confirmed.",
          });
          setShowVAModal(false);
          setShowThankYouModal(false);
          setShowPaymentFailureModal(true);
          return;
        }
      }
    } catch {}

    // 2) If a pending virtual account exists after reload, show it and immediately check inflow.
    if (!orderIdToCheck || !virtualAccount?.vNUBAN) return;

    let cancelled = false;

    (async () => {
      try {
        setShowVAModal(true);
        const paid = await silentAutoReconcilePayment();
        if (cancelled || paid) return;

        const expiry = getExpiryRemaining(vaExpireAt);
        if (vaExpireAt && expiry?.ok && expiry?.minutesLeft <= 0) {
          openPaymentFailureModal({
            amount: payableAmount,
            mode: getPaymentModeForCurrentPage(),
            orderId: orderIdToCheck,
            message:
              "This payment account has expired and payment was not confirmed.",
          });
        }
      } catch (e) {
        console.warn("Reload resume check failed:", e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentUser,
    pendingOrderId,
    shipmentOrderId,
    balanceOrderId,
    isShipmentMode,
    isBalanceMode,
    virtualAccount?.vNUBAN,
    vaExpireAt,
    payableAmount,
  ]);

  // ================================
  // PAYSTACK DVA
  // ================================
  const normalizePaystackPhone = (value = "") => {
    const digits = String(value || "").replace(/\D/g, "");

    if (/^0\d{10}$/.test(digits)) {
      return `+234${digits.slice(1)}`;
    }

    if (/^234\d{10}$/.test(digits)) {
      return `+${digits}`;
    }

    if (/^\d{10}$/.test(digits)) {
      return `+234${digits}`;
    }

    return "";
  };

  const getPaystackCustomerDetails = (address = {}) => {
    const displayParts = String(currentUser?.displayName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const firstName =
      String(address?.firstName || displayParts[0] || "Customer").trim();
    const lastName =
      String(
        address?.lastName ||
          displayParts.slice(1).join(" ") ||
          "User",
      ).trim();
    const email = String(
      address?.email || currentUser?.email || "",
    )
      .trim()
      .toLowerCase();
    // Only the provider request uses international format; stored/displayed phones stay local.
    const phone = normalizePaystackPhone(normalizeNgPhoneToLocal(address?.phone));

    if (!email) {
      throw new Error("A customer email is required for Paystack.");
    }

    if (!phone) {
      throw new Error(
        "Paystack requires a valid Nigerian phone number. Please update the shipping phone number and try again.",
      );
    }

    return { firstName, lastName, email, phone };
  };

  const getPaystackPaymentFromOrder = (order, mode) => {
    if (mode === "shipment") {
      return order?.shipmentPayment?.payment || {};
    }
    if (mode === "balance") {
      return order?.balancePayment?.payment || {};
    }
    return order?.payment || {};
  };

  const waitForPaystackDvaAssignment = async ({
    uid,
    orderId,
    mode,
    timeoutMs = 45000,
  }) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const snap = await getDoc(
        doc(db, ...folangeUserOrderPath(uid, orderId)),
      );

      if (!snap.exists()) {
        throw new Error("Order not found while waiting for Paystack.");
      }

      const order = snap.data() || {};
      const payment = getPaystackPaymentFromOrder(order, mode);

      const assignmentStatus = String(
        payment?.assignmentStatus ||
          payment?.paystack?.assignmentStatus ||
          "",
      ).toLowerCase();

      const accountNumber = String(
        payment?.accountNumber ||
          payment?.paystack?.accountNumber ||
          "",
      )
        .replace(/\D/g, "")
        .trim();

      if (assignmentStatus === "assigned" && accountNumber) {
        return {
          vNUBAN: accountNumber,
          accountNumber,
          accountName:
            payment?.accountName ||
            payment?.paystack?.accountName ||
            "Import With Bliss Customer",
          bankName:
            payment?.bankName ||
            payment?.paystack?.bankName ||
            "Paystack",
          bankSlug:
            payment?.bankSlug ||
            payment?.paystack?.bankSlug ||
            "",
          type: "PAYSTACK DVA",
          provider: "PAYSTACK_DVA",
          createdAt:
            payment?.assignedAt ||
            payment?.paystack?.assignedAt ||
            null,
          expireAt: null,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new Error(
      "Paystack is still preparing the virtual account. Please try again in a few seconds.",
    );
  };

  const getPaystackOutstandingForCurrentPage = () => {
    // Paystack has its own customer charge: 1% capped at ₦300.
    // For shipment/balance, an already-stored outstanding amount remains the
    // source of truth so a later part-payment does not add VAT a second time.
    const paystackFreshBase = Number(payableBaseAmount || 0);
    const paystackFreshTotal =
      paystackFreshBase + (isShipmentMode ? 0 : calcPaystackVat(isBalanceMode ? paystackFreshBase : cartTotalAmount));
    const fallback = Number(paystackFreshTotal || 0);

    if (isBalanceMode) {
      const explicit = Number(
        balanceOrderDoc?.balancePayment?.outstanding ??
          balanceOrderDoc?.balancePayment?.payment?.outstanding ??
          balanceAmount ??
          fallback,
      );
      return Number.isFinite(explicit) && explicit > 0 ? explicit : fallback;
    }

    if (isShipmentMode) {
      const ship = shipmentOrderDoc?.shipmentPayment || {};
      const base = Number(ship?.amount ?? shipmentAmount ?? 0);
      const paid = Math.max(0, Number(ship?.amountPaid) || 0,
        Number(ship?.payment?.amountPaid) || 0,
        Number(ship?.payment?.inflow?.paidTotal) || 0);
      const remaining = Math.max(0, base - paid);
      return Number.isFinite(remaining) ? remaining : fallback;
    }

    return fallback;
  };

  const showPaystackError = (message) => {
    setPaystackTransition({ status: "error", message: String(message || "Unable to continue with Paystack.") });
  };

  const openPaystackAmountOptions = () => {
    if (!isPaymentMethodAvailable("PAYSTACK_DVA")) return;
    const outstanding = Number(getPaystackOutstandingForCurrentPage() || 0);

    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      showPaystackError("There is no outstanding amount to pay.");
      return;
    }

    setPaystackPartAmount("");
    setShowPaystackAmountModal(true);
  };

  const confirmPaystackFullPayment = () => {
    const outstanding = Number(getPaystackOutstandingForCurrentPage() || 0);

    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      showPaystackError("There is no outstanding amount to pay.");
      return;
    }

    setPaystackSelectedAmount(outstanding);
    setShowPaystackAmountModal(false);
    handlePaystackPayment(outstanding);
  };

  const confirmPaystackPartPayment = () => {
    const outstanding = Number(getPaystackOutstandingForCurrentPage() || 0);
    const selected = Number(String(paystackPartAmount || "").replace(/,/g, ""));

    if (!Number.isFinite(selected) || selected <= 0) {
      showPaystackError("Enter a valid part-payment amount.");
      return;
    }

    if (selected >= outstanding) {
      showPaystackError(
        `For ${formatNaira(outstanding)}, use Pay Full Amount. Part payment must be less than the outstanding balance.`,
      );
      return;
    }

    // Keep payment amounts in whole naira because the rest of this checkout
    // and the existing Firestore accounting structure use naira integers.
    if (!Number.isInteger(selected)) {
      showPaystackError("Enter the amount in whole naira without kobo.");
      return;
    }

    setPaystackSelectedAmount(selected);
    setShowPaystackAmountModal(false);
    handlePaystackPayment(selected);
  };

  const startPaystackDva = async ({
    uid,
    orderId,
    orderPath,
    mode,
    amount,
    address,
  }) => {
    const customer = getPaystackCustomerDetails(address);
    const paymentRef =
      `PAYSTACK_${String(mode || "order").toUpperCase()}_${orderId}_${Date.now()}`;

    setPaymentReference(paymentRef);

    const preferredBank =
      process.env.NODE_ENV === "production"
        ? "titan-paystack"
        : "test-bank";

    const res = await fetch(
      "/.netlify/functions/paystack-create-dva",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: FOLANGE_STORE_ID,
          userId: uid,
          orderId,
          orderPath: getFolangeOrderPath(uid, orderId),
          paymentMode: mode,
          ...(mode === "shipment" ? { vatExempt: true, vatAmount: 0 } : {}),
          paymentReference: paymentRef,
          amount: Number(amount),
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          preferredBank,
        }),
      },
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.success === false) {
      throw new Error(
        data?.message ||
          data?.error ||
          "Unable to prepare Paystack virtual account.",
      );
    }

    const va = await waitForPaystackDvaAssignment({
      uid,
      orderId,
      mode,
    });

    return { va, paymentRef };
  };

  const handlePaystackPayment = async (selectedAmount) => {
    if (payNowInFlightRef.current || vaLoading) return;

    let createdOrderIdForAttempt = "";

    try {
      if (!currentUser) {
        showPaystackError("Please sign in to continue.");
        return;
      }

      if (!shippingAddress) {
        showPaystackError("Please fill your shipping address first.");
        if (!isPaymentOnlyMode) setCurrentStep("shipping");
        return;
      }

      payNowInFlightRef.current = true;
      setVaLoading(true);
      setActivePaymentProvider("PAYSTACK_DVA");
      setPaystackTransition({ status: "preparing", message: "Preparing your Paystack payment account. Please keep this page open." });
      await requirePaymentMethodAvailable("PAYSTACK_DVA");

      const mode = getPaymentModeForCurrentPage();
      const uid = isBalanceMode
        ? balanceOrderOwnerId
        : isShipmentMode
          ? shipmentOrderOwnerId
          : currentUser.uid;

      let orderId = isBalanceMode
        ? balanceOrderId
        : isShipmentMode
          ? shipmentOrderId
          : "";

      let orderPath = isBalanceMode
        ? balanceOrderPath || normalizeFolangeOrderPath(balanceOrderDoc?.orderPath)
        : isShipmentMode
          ? shipmentOrderPath || normalizeFolangeOrderPath(shipmentOrderDoc?.orderPath)
          : "";

      const maximumOutstanding = Number(
        getPaystackOutstandingForCurrentPage() || 0,
      );
      const amount = Number(selectedAmount || 0);

      if (!Number.isFinite(maximumOutstanding) || maximumOutstanding <= 0) {
        throw new Error("There is no outstanding amount to pay.");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Payment amount is invalid.");
      }

      if (amount > maximumOutstanding) {
        throw new Error(
          `You cannot pay more than the outstanding amount of ${formatNaira(maximumOutstanding)}.`,
        );
      }

      if (!Number.isInteger(amount)) {
        throw new Error("Payment amount must be entered in whole naira.");
      }

      setPaystackSelectedAmount(amount);

      if (isPaymentOnlyMode && !orderId) {
        throw new Error("Missing order id.");
      }

      // Normal checkout still uses the existing order builder so cart,
      // VAT, customer and shipping fields remain exactly as before.
      if (!isPaymentOnlyMode) {
        const baseToPay = Number(cartGrandTotal || 0);
        const vatAmount = calcPaystackVat(cartTotalAmount);
        const paymentAmount = baseToPay + vatAmount;

        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
          throw new Error("Cart total is invalid.");
        }

        // Reuse only the order created by THIS mounted checkout session.
        // Never reuse a historical pendingOrderId restored from Firestore.
        // This prevents an old sale from August/another visit being recycled
        // as today's new order merely because cart and total happen to match.
        const sessionOrderId = String(
          currentCheckoutOrderIdRef.current || "",
        ).trim();

        if (sessionOrderId) {
          try {
            const existingRef = doc(db, ...folangeUserOrderPath(currentUser.uid, sessionOrderId));
            const existingSnap = await getDoc(existingRef);

            if (existingSnap.exists()) {
              const existingOrder = existingSnap.data() || {};
              const isPaid =
                String(existingOrder?.orderStatus || "").toLowerCase() === "paid" ||
                String(existingOrder?.payment?.status || "").toLowerCase() === "paid" ||
                !!existingOrder?.payment?.paidAt;

              if (!isPaid) {
                orderId = sessionOrderId;
                orderPath =
                  normalizeFolangeOrderPath(existingOrder?.orderPath) ||
                  getFolangeOrderPath(currentUser.uid, orderId);
              } else {
                currentCheckoutOrderIdRef.current = "";
              }
            } else {
              currentCheckoutOrderIdRef.current = "";
            }
          } catch (error) {
            console.warn(
              "Could not inspect current checkout order before Paystack:",
              error?.message || error,
            );
          }
        }

        if (!orderId) {
          const provisionalRef =
            `PAYSTACK_PENDING_${Date.now()}`;

          orderId = await createPendingOrder({
            paymentRef: provisionalRef,
            meta: {
              source: "Checkout Paystack",
              baseToPay,
              vatAmount,
              amount: paymentAmount,
              paymentProvider: "PAYSTACK_DVA",
              vatRate: PAYSTACK_VAT_RATE,
              vatCap: PAYSTACK_VAT_CAP,
            },
            vatRate: PAYSTACK_VAT_RATE,
            vatCap: PAYSTACK_VAT_CAP,
          });

          createdOrderIdForAttempt = orderId;
          orderPath =
            getFolangeOrderPath(currentUser.uid, orderId);
        }

        setPendingOrderId(orderId);
      }

      // A Paystack DVA may be reusable, but each click here represents a NEW
      // payment intent with its own exact expected amount. Do not short-circuit
      // merely because the customer already has an account number. The backend
      // may reuse the same DVA while storing this new expected amount safely.

      const { va, paymentRef } = await startPaystackDva({
        uid,
        orderId,
        orderPath,
        mode,
        amount,
        address: shippingAddress,
      });

      setPaymentReference(paymentRef);
      setPendingOrderId(orderId);
      setVirtualAccount(va);
      setVaExpireAt(null);
      setActivePaymentProvider("PAYSTACK_DVA");
      setShowVAModal(true);
      setCurrentStep("payment");

      persistPendingCheckoutCache({
        orderId,
        orderPath:
          orderPath || getFolangeOrderPath(uid, orderId),
        mode,
        provider: "PAYSTACK_DVA",
        expectedAmount: amount,
        va,
      });

      // The account-details screen is the ready transition; no success toast.
      setPaystackTransition(null);
    } catch (error) {
      console.error("Paystack checkout error:", error);

      if (createdOrderIdForAttempt) {
        showPaystackError(
          `Order ${createdOrderIdForAttempt} was saved, but Paystack could not prepare the account. Click Pay with Paystack again to retry this same order.`,
        );
      } else {
        showPaystackError(
          error?.message ||
            "Unable to start Paystack payment.",
        );
      }
    } finally {
      setVaLoading(false);
      payNowInFlightRef.current = false;
    }
  };

  // ================================
  // PAY NOW FLOW
  // ✅ Upgraded:
  // - HARD guard against multiple clicks
  // - extra: re-check order doc before generating a new VA (reduces quota burn)
  // - friendly quota error messaging
  // ================================
  const handlePayNow = async () => {
    // hard lock
    if (payNowInFlightRef.current) return;

    // If VA creation fails after the order document was committed, retain and
    // report the exact saved order instead of making it look like it vanished.
    let createdOrderIdForAttempt = "";

    try {
      if (!currentUser) {
        toast.error("Please sign in to continue.");
        return;
      }

      if (!shippingAddress) {
        toast.error("Please fill your shipping address first.");
        if (!isPaymentOnlyMode) setCurrentStep("shipping");
        return;
      }

      // ✅ If already in loading state, bail
      if (vaLoading) return;

      // ✅ Lock immediately (prevents double click even before state updates)
      payNowInFlightRef.current = true;
      setVaLoading(true);
      setActivePaymentProvider("UBA_VAS");
      await requirePaymentMethodAvailable("UBA_VAS");

      // ✅ If a VA is already present in UI, reuse
      if (
        !isPaymentOnlyMode &&
        pendingOrderId &&
        virtualAccount?.vNUBAN &&
        false // disable reuse for fresh orders
      ) {
        setShowVAModal(true);
        setCurrentStep("payment");
        toast.info("Using your existing pending virtual account.");
        return;
      }

      // ✅ Ensure BVN on shipping profile
      const paymentOwnerId = isBalanceMode
        ? balanceOrderOwnerId
        : isShipmentMode
          ? shipmentOrderOwnerId
          : currentUser.uid;

      let localAddress = await ensureBvnForUser(
        paymentOwnerId,
        shippingAddress,
      );
      setShippingAddress(normalizeCheckoutShippingAddress(localAddress));

      // ✅ Generate payment reference and store in state
      const paymentRef =
        "VAS_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10);
      setPaymentReference(paymentRef); // <-- STORE IT

      // ✅ BALANCE MODE (KEEP THIS STYLE)
      if (isBalanceMode) {
        if (!balanceOrderId) {
          toast.error("Missing balance order id");
          return;
        }

        // ✅ Re-check order doc to reuse VA (extra safety)
        try {
          const ref = doc(db, ...folangeUserOrderPath(balanceOrderOwnerId, balanceOrderId));
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const od = { id: balanceOrderId, ...(snap.data() || {}) };
            const existingBalanceVa = getVaFromOrderDoc(od, "balance");
            const balState = String(
              od?.balancePayment?.state ||
                od?.balancePayment?.payment?.state ||
                "",
            ).toLowerCase();
            if (existingBalanceVa?.vNUBAN && balState !== "paid") {
              setBalanceOrderDoc(od);
              setPendingOrderId(balanceOrderId);
              setVirtualAccount(existingBalanceVa);
              setVaExpireAt(existingBalanceVa?.expireAt || null);
              setShowVAModal(true);
              setCurrentStep("payment");
              toast.info("Using existing balance virtual account.");
              return;
            }
          }
        } catch {}

        const baseToPay = Number(balanceAmount || 0);
        if (!Number.isFinite(baseToPay) || baseToPay <= 0) {
          toast.error("Balance amount is invalid");
          return;
        }

        // Balance payments must always use a fresh DYNAMIC VA.
        // A customer may already own a STATIC VA, and requesting another STATIC
        // VA for the same BVN/customer can make the provider return HTTP 500.
        const va = await createBalanceVirtualAccountForExistingOrder(
          localAddress,
          balanceOrderId,
          balanceOrderPath || normalizeFolangeOrderPath(balanceOrderDoc?.orderPath),
          paymentRef,
          baseToPay,
        );

        setPendingOrderId(balanceOrderId);
        setVirtualAccount(va);
        setVaExpireAt(va?.expireAt || null);

        toast.success(
          "Balance virtual account ready. Please transfer to the account shown.",
        );

        setShowVAModal(true);
        setCurrentStep("payment");
        return;
      }

      // ✅ SHIPMENT MODE (KEEP THIS STYLE)
      if (isShipmentMode) {
        if (!shipmentOrderId) {
          toast.error("Missing shipment order id");
          return;
        }

        // ✅ Re-check order doc to reuse VA (extra safety)
        try {
          const ref = doc(db, ...folangeUserOrderPath(shipmentOrderOwnerId, shipmentOrderId));
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const od = { id: shipmentOrderId, ...(snap.data() || {}) };
            const existingShipmentVa = getVaFromOrderDoc(od, "shipment");
            const shipState = String(
              od?.shipmentPayment?.state ||
                od?.shipmentPayment?.payment?.state ||
                "",
            ).toLowerCase();
            if (existingShipmentVa?.vNUBAN && shipState !== "paid") {
              setShipmentOrderDoc(od);
              setPendingOrderId(shipmentOrderId);
              setVirtualAccount(existingShipmentVa);
              setVaExpireAt(existingShipmentVa?.expireAt || null);
              setShowVAModal(true);
              setCurrentStep("payment");
              toast.info("Using existing shipment virtual account.");
              return;
            }
          }
        } catch {}

        const baseToPay = Number(shipmentAmount || 0);
        if (!Number.isFinite(baseToPay) || baseToPay <= 0) {
          toast.error("Shipment amount is invalid");
          return;
        }

        const va = USE_STATIC_VA_FOR_TEST
          ? await createStaticShipmentVirtualAccountForExistingOrder(
              localAddress,
              shipmentOrderId,
              shipmentOrderPath || normalizeFolangeOrderPath(shipmentOrderDoc?.orderPath),
              paymentRef,
              baseToPay,
            )
          : await createShipmentVirtualAccountForExistingOrder(
              localAddress,
              shipmentOrderId,
              shipmentOrderPath || normalizeFolangeOrderPath(shipmentOrderDoc?.orderPath),
              paymentRef,
              baseToPay,
            );

        setPendingOrderId(shipmentOrderId);
        setVirtualAccount(va);
        setVaExpireAt(va?.expireAt || null);

        toast.success(
          USE_STATIC_VA_FOR_TEST
            ? "Static virtual account ready. Please transfer to the account shown."
            : "Shipment virtual account ready. Please transfer to the account shown.",
        );

        setShowVAModal(true);
        setCurrentStep("payment");
        return;
      }

      // ✅ NORMAL MODE (KEEP THIS STYLE)
      const baseToPay = Number(cartGrandTotal || 0);
      if (!Number.isFinite(baseToPay) || baseToPay <= 0) {
        toast.error("Cart total is invalid.");
        return;
      }

      const vatAmount = calcVat(cartTotalAmount);
      const paymentAmount = baseToPay + vatAmount;

      let orderId = "";

      // Reuse only the order created by THIS mounted checkout session.
      // A historical pendingOrderId restored from Firestore is not today's sale.
      const sessionOrderId = String(
        currentCheckoutOrderIdRef.current || "",
      ).trim();

      if (sessionOrderId) {
        try {
          const existingRef = doc(db, ...folangeUserOrderPath(currentUser.uid, sessionOrderId));
          const existingSnap = await getDoc(existingRef);

          if (existingSnap.exists()) {
            const existingOrder = existingSnap.data() || {};
            const isPaid =
              String(existingOrder?.orderStatus || "").toLowerCase() === "paid" ||
              String(existingOrder?.payment?.status || "").toLowerCase() === "paid" ||
              !!existingOrder?.payment?.paidAt;

            if (!isPaid) {
              orderId = sessionOrderId;
              persistPendingCheckoutCache({
                orderId,
                orderPath:
                  normalizeFolangeOrderPath(existingOrder?.orderPath) ||
                  getFolangeOrderPath(currentUser.uid, orderId),
                mode: "order",
              });
              toast.info("Continuing this checkout's pending order.");
            } else {
              currentCheckoutOrderIdRef.current = "";
            }
          } else {
            currentCheckoutOrderIdRef.current = "";
          }
        } catch (error) {
          console.warn(
            "Could not inspect this checkout's order; creating a new one:",
            error?.message || error,
          );
        }
      }

      if (!orderId) {
        orderId = await createPendingOrder({
          paymentRef,
          meta: {
            source: "Checkout Pay Now",
            baseToPay,
            vatAmount,
            amount: paymentAmount,
            vaRequestedType: USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC",
          },
        });
      }

      createdOrderIdForAttempt = orderId;

      setPendingOrderId(orderId);

      // ✅ EXTRA SAFETY: if something already wrote VA to this order, reuse it
      try {
        const ref = doc(db, ...folangeUserOrderPath(currentUser.uid, orderId));
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const od = { id: orderId, ...(snap.data() || {}) };
          const existingOrderVa = getVaFromOrderDoc(od, "order");
          const paid =
            String(od?.orderStatus || "").toLowerCase() === "paid" ||
            String(od?.payment?.status || "").toLowerCase() === "paid" ||
            !!od?.payment?.paidAt;

          if (!paid && existingOrderVa?.vNUBAN) {
            setVirtualAccount(existingOrderVa);
            setVaExpireAt(existingOrderVa?.expireAt || null);
            persistPendingCheckoutCache({
              orderId,
              orderPath: getFolangeOrderPath(currentUser.uid, orderId),
              mode: "order",
              va: existingOrderVa,
            });
            toast.info("Using existing order virtual account.");
            setShowVAModal(true);
            setCurrentStep("payment");
            return;
          }
        }
      } catch {}

      const va = USE_STATIC_VA_FOR_TEST
        ? await createStaticVirtualAccountForOrder(
            localAddress,
            orderId,
            paymentRef,
            paymentAmount,
          )
        : await createDynamicVirtualAccountForOrder(
            localAddress,
            orderId,
            paymentRef,
            paymentAmount,
          );

      setVirtualAccount(va);
      setVaExpireAt(va?.expireAt || null);

      persistPendingCheckoutCache({
        orderId,
        orderPath: getFolangeOrderPath(currentUser.uid, orderId),
        mode: "order",
        va: {
          vNUBAN: String(va?.vNUBAN || ""),
          accountName: va?.accountName || null,
          type: va?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC"),
          createdAt: va?.createdAt || null,
          expireAt: va?.expireAt || null,
        },
      });

      toast.success(
        USE_STATIC_VA_FOR_TEST
          ? "Static virtual account ready. Please transfer to the account shown."
          : "Virtual account ready. Please transfer to the account shown.",
      );

      setShowVAModal(true);
      setCurrentStep("payment");
      return;
    } catch (e) {
      console.error("PayNow flow error:", e);

      if (createdOrderIdForAttempt) {
        toast.error(
          `Order ${createdOrderIdForAttempt} was saved, but the payment account could not be prepared. Please retry payment for this same order; do not place another order.`,
        );
      } else {
        const errorCode = String(e?.code || "").toLowerCase();
        const errorMessage = String(e?.message || "").toLowerCase();

        if (
          errorCode.includes("permission-denied") ||
          errorMessage.includes("insufficient permissions")
        ) {
          toast.error(
            "The order was not saved because Firestore denied the write. Please contact the administrator.",
          );
        } else if (
          errorCode.includes("invalid-argument") ||
          errorMessage.includes("unsupported field value")
        ) {
          toast.error(
            "The order was not saved because one of the cart items contains invalid data. Please refresh the cart and try again.",
          );
        } else {
          toast.error(getFriendlyVasErrorMessage(e));
        }
      }
    } finally {
      setVaLoading(false);
      payNowInFlightRef.current = false;
    }
  };

  const goToNextStep = () => {
    if (isPaymentOnlyMode) return;
    const order = ["shipping", "review", "payment"];
    const currentIndex = order.indexOf(currentStep);
    if (currentIndex < order.length - 1)
      setCurrentStep(order[currentIndex + 1]);
  };

  const goToPreviousStep = () => {
    if (isPaymentOnlyMode) return;
    const order = ["shipping", "review", "payment"];
    const currentIndex = order.indexOf(currentStep);
    if (currentIndex > 0) setCurrentStep(order[currentIndex - 1]);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Always accessible above the checkout and payment overlays. */}
      <button
        type="button"
        onClick={() => {
          persistPaymentResultCache(null);
          navigate("/");
        }}
        aria-label="Close checkout and return to the home page"
        title="Close checkout and continue shopping"
        className="fixed top-4 right-4 z-[1100] inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-lg transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        <FaTimes aria-hidden="true" />
        <span>Close &amp; continue shopping</span>
      </button>

      {/* Tiny CSS for modal animations */}
      <style>{`
        @keyframes tyFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tyBackdrop { from { opacity: 0; backdrop-filter: blur(0px); } to { opacity: 1; backdrop-filter: blur(6px); } }
        @keyframes tyPop {
          0% { opacity: 0; transform: translateY(18px) scale(0.94); }
          60% { opacity: 1; transform: translateY(-2px) scale(1.015); }
          100% { opacity: 1; transform: translateY(0px) scale(1); }
        }
        @keyframes tyRing { 0% { transform: scale(0.75); opacity: 0.35; } 100% { transform: scale(1.55); opacity: 0; } }
        @keyframes tyCheck {
          0% { opacity: 0; transform: scale(0.55) rotate(-12deg); }
          65% { opacity: 1; transform: scale(1.12) rotate(3deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes tyFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes tyProgress { from { width: 0%; } to { width: 100%; } }
      `}</style>

      <div className="flex-1 overflow-y-auto pt-44 sm:pt-48 pb-20 px-4">
        {isAdmin && (
          <section className="max-w-4xl mx-auto mb-8 bg-white border rounded-2xl p-5 shadow-sm" aria-label="Admin payment controls">
            <h2 className="text-lg font-bold text-gray-900">Admin payment controls</h2>
            <p className="text-sm text-gray-600 mt-1">Enable or disable payment options for every checkout. You can turn off one or both.</p>
            <div className="flex flex-wrap gap-3 mt-4">
              {[{ provider: "PAYSTACK_DVA", label: "Paystack" }, { provider: "UBA_VAS", label: "UBA" }].map(({ provider, label }) => (
                <button key={provider} type="button" role="switch" aria-checked={paymentMethods[provider]}
                  disabled={!paymentMethodsLoaded || Boolean(paymentMethodsError) || Boolean(savingPaymentMethod)}
                  onClick={() => togglePaymentMethod(provider)}
                  className={`px-4 py-3 rounded-xl font-semibold border transition disabled:opacity-50 ${paymentMethods[provider] ? "bg-green-50 text-green-800 border-green-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
                  {savingPaymentMethod === provider ? "Saving..." : `${label}: ${paymentMethods[provider] ? "On — turn off" : "Off — turn on"}`}
                </button>
              ))}
            </div>
          </section>
        )}
        {(paymentMethodsError || !paymentMethodsLoaded || (!paymentMethods.PAYSTACK_DVA && !paymentMethods.UBA_VAS)) && (
          <p role="status" className="max-w-4xl mx-auto mb-6 rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900">
            {paymentMethodsError || (!paymentMethodsLoaded ? "Loading payment options..." : "Payments are currently paused. Please check back later.")}
          </p>
        )}
        {/* Progress bar */}
        <div className="max-w-4xl mx-auto mb-12 relative">
          <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-300 -z-10" />
          <div
            className="absolute top-1/2 left-0 h-1 bg-red-500 transition-all duration-500"
            style={{ width: progressWidth, transform: "translateY(-50%)" }}
          />
          <div className="flex justify-between items-center">
            {steps.map((step, i) => {
              const isCompleted = i < stepIndex;
              const isActive = step.key === currentStep;
              return (
                <div key={step.key} className="flex flex-col items-center z-10">
                  <div
                    className={`w-14 h-14 flex items-center justify-center rounded-full text-white text-xl shadow-lg ${
                      isCompleted
                        ? "bg-green-500"
                        : isActive
                          ? "bg-red-500"
                          : "bg-gray-400"
                    } transition`}
                  >
                    {isCompleted ? <FaCheck /> : step.icon}
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">
                    {step.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ✅ Optional restore loading hint */}
        {!isPaymentOnlyMode && restoringPendingVA && (
          <div className="max-w-lg mx-auto mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Restoring your pending payment session...
          </div>
        )}

        {/* SHIPPING (disabled for shipment/balance mode) */}
        {!isPaymentOnlyMode && currentStep === "shipping" && (
          <div className="max-w-2xl mx-auto bg-white p-6 rounded-2xl shadow-md">
            <ShippingAddress
              user={currentUser}
              onSuccess={handleAddressSaved}
            />
          </div>
        )}

        {/* REVIEW (disabled for shipment/balance mode) */}
        {!isPaymentOnlyMode && currentStep === "review" && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl p-6 shadow-md text-gray-800">
            <h2 className="text-2xl font-semibold mb-6 text-center">
              Review & Confirm
            </h2>

            <div className="border-b pb-4 mb-6">
              <h3 className="text-lg font-semibold mb-2 text-gray-700">
                Shipping Information
              </h3>
              <div className="text-gray-700 space-y-1">
                <p>
                  <strong>Name:</strong> {shippingAddress?.title}{" "}
                  {shippingAddress?.firstName} {shippingAddress?.lastName}
                </p>
                <p>
                  <strong>Phone:</strong> {shippingAddress?.phone}
                </p>
                <p>
                  <strong>Email:</strong> {shippingAddress?.email}
                </p>
                <p>
                  <strong>Address:</strong>{" "}
                  {getReadableShippingAddress(shippingAddress || {}) ||
                    `${shippingAddress?.address || ""}, ${shippingAddress?.city || ""}, ${
                      shippingAddress?.state || ""
                    }, ${shippingAddress?.country || ""}`.trim()}
                </p>
              </div>
            </div>

            <div className="border-b pb-4 mb-6">
              <h3 className="text-lg font-semibold mb-3 text-gray-700">
                Your Cart
              </h3>
              {cart && cart.length > 0 ? (
                <div className="divide-y">
                  {cart.map((item, index) => (
                    <div
                      key={index}
                      className="flex justify-between py-2 text-sm sm:text-base"
                    >
                      <div className="pr-3">
                        <div>
                          {item.name} × {item.quantity}
                        </div>
                      </div>
                      <span>
                        ₦{(item.price * item.quantity).toLocaleString()}
                      </span>
                    </div>
                  ))}

                  <div className="flex justify-between pt-3 text-sm text-gray-700">
                    <span>Shipment Fee:</span>
                    <span>₦{cartShipmentFee?.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between pt-2 text-sm text-gray-700">
                    <span>VAT (0.4% capped ₦300):</span>
                    <span>₦{calcVat(cartTotalAmount).toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between font-semibold text-gray-800 pt-3 text-lg">
                    <span>Grand Total (Incl. VAT):</span>
                    <span>
                      ₦
                      {(
                        cartGrandTotal + calcVat(cartTotalAmount)
                      ).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">Your cart is empty.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-between gap-3 mt-6">
              <button
                onClick={goToPreviousStep}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-6 py-3 rounded-lg font-semibold w-full sm:w-auto transition"
              >
                Back
              </button>
              <button
                onClick={goToNextStep}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-semibold w-full sm:w-auto transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* PAYMENT */}
        {currentStep === "payment" && (
          <div className="max-w-lg mx-auto bg-white rounded-2xl p-6 shadow-md text-center">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              {isBalanceMode
                ? "Pay Balance"
                : isShipmentMode
                  ? "Pay Shipment Fee"
                  : "Payment Information"}
            </h2>

            {USE_STATIC_VA_FOR_TEST && (
              <div>
                {/* <p className="text-xs text-blue-700 mt-1">
                  This payment flow will request a <b>STATIC</b> virtual account
                </p> */}
              </div>
            )}

            {isShipmentMode || isBalanceMode ? (
              <div
                className={`text-left border rounded-lg p-4 mb-4 ${
                  isShipmentMode
                    ? "bg-yellow-50 border-yellow-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <p className="font-semibold text-gray-800 mb-1">
                  {isBalanceMode ? "Balance Payment" : "Shipment Payment"}
                </p>
                <p className="text-sm text-gray-700">
                  Order ID:{" "}
                  <span className="font-mono">
                    {isBalanceMode
                      ? balanceOrderId || "—"
                      : shipmentOrderId || "—"}
                  </span>
                </p>

                <p className="text-sm text-gray-700 mt-2">
                  Amount to Pay (Base):{" "}
                  <b>₦{Number(payableBaseAmount || 0).toLocaleString()}</b>
                </p>
                <p className="text-sm text-gray-700 mt-1">
                  VAT (0.4% capped ₦300):{" "}
                  <b>₦{Number(payableVatAmount || 0).toLocaleString()}</b>
                </p>
                <p className="text-sm text-gray-900 mt-1">
                  Total (Base + VAT): <b>₦{payableAmount.toLocaleString()}</b>
                </p>
              </div>
            ) : (
              <div className="text-left bg-gray-50 border rounded-lg p-4 mb-4">
                <p className="font-semibold text-gray-800 mb-1">
                  Order Summary
                </p>
                <p className="text-sm text-gray-700 mt-2">
                  Amount to Pay (Base):{" "}
                  <b>₦{Number(payableBaseAmount || 0).toLocaleString()}</b>
                </p>
                <p className="text-sm text-gray-700 mt-1">
                  VAT (0.4% capped ₦300):{" "}
                  <b>₦{payableVatAmount.toLocaleString()}</b>
                </p>
                <p className="text-sm text-gray-900 mt-1">
                  Total (Base + VAT): <b>₦{payableAmount.toLocaleString()}</b>
                </p>
              </div>
            )}

            {!isPaymentOnlyMode ? (
              <p className="text-gray-700 mb-4">
                Click <strong>Pay Now</strong> to create your order and generate
                your UBA virtual account.
              </p>
            ) : null}

            <div className="text-left bg-gray-50 border rounded-lg p-4 mb-4">
              {/* <p className="font-semibold text-gray-800 mb-2">Bank Transfer Details</p> */}

              {!USE_STATIC_VA_FOR_TEST ? (
                <p className="text-xs text-gray-600 mb-2">
                  Transfer window: <b>{VA_EXPIRY_MINUTES} minutes</b>{" "}
                  {VA_EXPIRY_MINUTES % 60 === 0 ? (
                    <span className="text-gray-500">
                      ({VA_EXPIRY_MINUTES / 60} hour
                      {VA_EXPIRY_MINUTES / 60 === 1 ? "" : "s"})
                    </span>
                  ) : null}
                  . After expiry, generate a new virtual account.
                </p>
              ) : (
                <p className="text-xs text-gray-600 mb-2">
                  {/* Static virtual account mode: no expiry. */}
                </p>
              )}

              {virtualAccount?.vNUBAN ? (
                <>
                  {/* <p className="text-gray-700">
        A virtual account has been generated. Transfer the exact amount to the account.
      </p> */}

                  {/* ✅ CLEAN ORDER REF */}
                  <div className="text-sm text-gray-700 mt-3">
                    <span className="font-semibold">Order Ref:</span>{" "}
                    <span className="font-mono">
                      {isBalanceMode
                        ? balanceOrderId || "—"
                        : isShipmentMode
                          ? shipmentOrderId || "—"
                          : pendingOrderId || "—"}
                    </span>
                  </div>

                  {/* ✅ EXPIRY / TYPE */}
                  {vaExpireAt ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Expires: <span className="font-mono">{vaExpireAt}</span>
                      {vaRemainingLabel && (
                        <span className="ml-2 px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
                          {vaRemainingLabel}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-1">
                      {/* Type:{" "}
          <span className="font-semibold">
            {virtualAccount?.type || (USE_STATIC_VA_FOR_TEST ? "STATIC" : "DYNAMIC")}
          </span> */}
                    </div>
                  )}

                  {/* ✅ ACTION BUTTONS (CLEAN + FOCUSED) */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={reconcileOrderPayment}
                      disabled={reconLoading}
                      className={`${
                        reconLoading
                          ? "bg-gray-400"
                          : "bg-green-700 hover:bg-green-800"
                      } text-white px-4 py-2 rounded-lg font-semibold transition`}
                    >
                      {reconLoading ? "Checking..." : "I have paid (Confirm)"}
                    </button>

                    {!isPaymentOnlyMode && (
                      <button
                        onClick={handleCancelPendingPayment}
                        className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg font-semibold transition"
                      >
                        Cancel Pending Payment
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p>
                  {/* No virtual account yet. Click <strong>Pay Now</strong> to generate it. */}
                </p>
              )}
            </div>

            {/* ✅ NOTE (OPTIONAL) + PERMANENT LOCK after sending */}
            <div className="text-left mt-2">
              <label
                htmlFor="note"
                className="block text-gray-700 font-medium mb-2"
              >
                Note for the Merchant{" "}
                <span className="text-gray-500 font-normal">(Optional)</span>
              </label>

              <textarea
                id="note"
                rows="3"
                className={`w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-400 outline-none ${
                  noteLocked ? "bg-gray-100 text-gray-500" : ""
                }`}
                placeholder="Optional: Add any special instruction or note and your phone number..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={noteLocked}
              />

              <button
                onClick={() =>
                  handleSaveNote(
                    isBalanceMode
                      ? balanceOrderDoc
                      : isShipmentMode
                        ? shipmentOrderDoc
                        : null,
                  )
                }
                disabled={savingNote || noteLocked}
                className={`mt-3 font-semibold px-6 py-2 rounded-lg transition w-full sm:w-auto ${
                  noteLocked
                    ? "bg-gray-300 text-gray-700 cursor-not-allowed"
                    : savingNote
                      ? "bg-gray-500 text-white opacity-70 cursor-not-allowed"
                      : "bg-gray-700 hover:bg-gray-800 text-white"
                }`}
                title={
                  noteLocked
                    ? "Note already sent for this order"
                    : !orderIdForNotes
                      ? "Click Pay Now first to create the order, then you can add an optional note."
                      : "Send note"
                }
              >
                {noteLocked
                  ? "Note Sent ✅"
                  : savingNote
                    ? "Sending..."
                    : "Add Note (Optional)"}
              </button>

              {!orderIdForNotes && !isPaymentOnlyMode ? (
                <p className="text-xs text-gray-500 mt-2">
                  Note can be sent after you click <b>Pay Now</b> (so we can
                  attach it to the order and lock it).
                </p>
              ) : null}
            </div>

            <div className="flex flex-col sm:flex-row justify-between gap-3 mt-6">
              {!isPaymentOnlyMode ? (
                <button
                  onClick={goToPreviousStep}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-5 py-3 rounded-lg font-semibold w-full sm:w-auto transition"
                >
                  Back
                </button>
              ) : (
                <button
                  onClick={() => navigate(-1)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-5 py-3 rounded-lg font-semibold w-full sm:w-auto transition"
                >
                  Back
                </button>
              )}

              {/* Paystack DVA payment option.
                  Both provider buttons are disabled while a payment request is
                  running, but only the provider actually clicked shows loading. */}
              <button
                type="button"
                onClick={openPaystackAmountOptions}
                disabled={vaLoading || !isPaymentMethodAvailable("PAYSTACK_DVA")}
                className={`${
                  vaLoading || !isPaymentMethodAvailable("PAYSTACK_DVA")
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-[#011B33] hover:bg-[#0B2A45]"
                } text-white px-5 py-3 rounded-lg font-semibold w-full sm:w-auto transition`}
              >
                {vaLoading && activePaymentProvider === "PAYSTACK_DVA"
                  ? "Processing..."
                  : !isPaymentMethodAvailable("PAYSTACK_DVA")
                    ? "Paystack unavailable"
                    : "Pay with Paystack"}
              </button>

              {/* UBA VAS payment option.
                  Both provider buttons are disabled while a payment request is
                  running, but only the provider actually clicked shows loading. */}
              <button
                type="button"
                onClick={handlePayNow}
                disabled={vaLoading || !isPaymentMethodAvailable("UBA_VAS")}
                className={`${
                  vaLoading || !isPaymentMethodAvailable("UBA_VAS")
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-[#D71920] hover:bg-[#B9141A]"
                } text-white px-5 py-3 rounded-lg font-semibold w-full sm:w-auto transition`}
              >
                {vaLoading && activePaymentProvider === "UBA_VAS"
                  ? "Processing..."
                  : !isPaymentMethodAvailable("UBA_VAS")
                    ? "UBA unavailable"
                    : "Pay with UBA"}
              </button>
            </div>
          </div>
        )}

        {/* Paystack preparation, awaiting-confirmation and error transition page. */}
        {paystackTransition && !showThankYouModal && (
          <section role="dialog" aria-modal="true" aria-label="Paystack payment status"
            className="fixed inset-0 z-[1000] bg-gray-50 flex items-center justify-center p-6 overflow-y-auto">
            <div className="w-full max-w-lg bg-white border shadow-xl rounded-3xl p-8 text-center">
              <p className="text-sm font-bold text-[#011B33] mb-3">Paystack</p>
              <h2 className="text-2xl font-bold text-gray-900">
                {paystackTransition.status === "preparing" ? "Preparing payment" : paystackTransition.status === "waiting" ? "Awaiting payment confirmation" : "Unable to continue"}
              </h2>
              <p role="status" className="text-gray-600 mt-4">{paystackTransition.message}</p>
              {paystackTransition.status === "preparing" ? (
                <div aria-label="Loading" className="w-10 h-10 mx-auto mt-6 border-4 border-gray-200 border-t-[#011B33] rounded-full animate-spin" />
              ) : (
                <button type="button" onClick={() => setPaystackTransition(null)}
                  className="mt-6 w-full bg-[#011B33] text-white font-bold rounded-xl px-5 py-3">
                  {paystackTransition.status === "waiting" ? "Return to account details" : "Return to checkout"}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Paystack Amount Choice Modal */}
        {showPaystackAmountModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div
              className="fixed inset-0 bg-black bg-opacity-50"
              onClick={() => setShowPaystackAmountModal(false)}
            />

            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-auto z-60 p-6">
              <button
                type="button"
                onClick={() => setShowPaystackAmountModal(false)}
                className="absolute top-3 right-3 text-gray-600 hover:text-gray-900"
                aria-label="Close"
              >
                <FaTimes />
              </button>

              <h3 className="text-xl font-semibold mb-2">Pay with Paystack</h3>
              <p className="text-sm text-gray-600 mb-4">
                Choose how much you want to pay now.
              </p>

              <div className="bg-gray-50 border rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-500">Outstanding Amount</p>
                <p className="text-2xl font-bold">
                  {formatNaira(getPaystackOutstandingForCurrentPage())}
                </p>
              </div>

              <button
                type="button"
                onClick={confirmPaystackFullPayment}
                disabled={vaLoading}
                className="w-full bg-[#0BA4DB] hover:bg-[#078FC0] text-white px-5 py-3 rounded-lg font-semibold transition"
              >
                Pay Full Amount —{" "}
                {formatNaira(getPaystackOutstandingForCurrentPage())}
              </button>

              <div className="my-5 border-t relative">
                <span className="absolute left-1/2 -translate-x-1/2 -top-3 bg-white px-3 text-xs text-gray-500">
                  OR
                </span>
              </div>

              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter Part Payment
              </label>
              <div className="flex items-center border rounded-lg overflow-hidden mb-2">
                <span className="px-3 text-gray-600 font-semibold">₦</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={paystackPartAmount}
                  onChange={(e) => setPaystackPartAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  className="flex-1 px-3 py-3 outline-none"
                />
              </div>

              {Number(paystackPartAmount || 0) > 0 &&
              Number(paystackPartAmount || 0) <
                Number(getPaystackOutstandingForCurrentPage() || 0) ? (
                <p className="text-sm text-gray-600 mb-4">
                  Balance after this payment:{" "}
                  <b>
                    {formatNaira(
                      Number(getPaystackOutstandingForCurrentPage() || 0) -
                        Number(paystackPartAmount || 0),
                    )}
                  </b>
                </p>
              ) : (
                <p className="text-xs text-gray-500 mb-4">
                  Part payment must be less than the outstanding amount.
                </p>
              )}

              <button
                type="button"
                onClick={confirmPaystackPartPayment}
                disabled={vaLoading || !paystackPartAmount}
                className={`w-full px-5 py-3 rounded-lg font-semibold transition ${
                  vaLoading || !paystackPartAmount
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-gray-800 hover:bg-gray-900 text-white"
                }`}
              >
                Continue with{" "}
                {paystackPartAmount
                  ? formatNaira(Number(paystackPartAmount || 0))
                  : "Part Payment"}
              </button>
            </div>
          </div>
        )}

        {/* Virtual Account Modal */}
        {showVAModal && virtualAccount && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div
              className="fixed inset-0 bg-black bg-opacity-50"
              onClick={() => {
                    setShowVAModal(false);
                    setVirtualAccount(null);
                    setVaExpireAt(null);
                    setActivePaymentProvider("");
                  }}
            />

            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-auto z-60 p-6">
              <button
                onClick={() => {
                    setShowVAModal(false);
                    setVirtualAccount(null);
                    setVaExpireAt(null);
                    setActivePaymentProvider("");
                  }}
                className="absolute top-3 right-3 text-gray-600 hover:text-gray-900"
                aria-label="Close"
              >
                <FaTimes />
              </button>

              <h3 className="text-xl font-semibold mb-3">
                Virtual Account Details
              </h3>

              <div className="space-y-2 text-left">
                <div>
                  <p className="text-sm text-gray-500">Bank</p>
                  <p className="font-medium">{virtualAccount?.bankName || (activePaymentProvider === "PAYSTACK_DVA" ? "Paystack" : "UBA")}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Order Ref</p>
                  <p className="font-mono">
                    {isBalanceMode
                      ? balanceOrderId || "—"
                      : isShipmentMode
                        ? shipmentOrderId || "—"
                        : pendingOrderId || "—"}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Account Number</p>
                  <p className="font-mono text-lg tracking-wider">
                    {virtualAccount.vNUBAN}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Account Name</p>
                  <p className="font-medium">{virtualAccount.accountName}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Account Type</p>
                  <p className="font-medium">
                    {virtualAccount?.type ||
                      (activePaymentProvider === "PAYSTACK_DVA"
                        ? "PAYSTACK DVA"
                        : USE_STATIC_VA_FOR_TEST
                          ? "STATIC"
                          : "DYNAMIC")}
                  </p>
                </div>

                {/* ✅ Breakdown */}
                {activePaymentProvider === "PAYSTACK_DVA" ? (
                  <div className="bg-gray-50 border rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm text-gray-700">
                      <span>Outstanding Before Payment</span>
                      <span className="font-semibold">
                        {formatNaira(getPaystackOutstandingForCurrentPage())}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-900 mt-2">
                      <span className="font-semibold">Exact Amount to Transfer</span>
                      <span className="font-bold">
                        {formatNaira(paystackSelectedAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-700 mt-1">
                      <span>Balance After Successful Payment</span>
                      <span className="font-semibold">
                        {formatNaira(
                          Math.max(
                            0,
                            Number(getPaystackOutstandingForCurrentPage() || 0) -
                              Number(paystackSelectedAmount || 0),
                          ),
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 border rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm text-gray-700">
                      <span>{payableLabel} (Base)</span>
                      <span className="font-semibold">
                        {formatNaira(payableBaseAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-700 mt-1">
                      <span>VAT (0.4% capped ₦300)</span>
                      <span className="font-semibold">
                        {formatNaira(payableVatAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-900 mt-2">
                      <span className="font-semibold">Total to Pay</span>
                      <span className="font-bold">
                        {formatNaira(payableAmount)}
                      </span>
                    </div>
                  </div>
                )}

                {vaExpireAt ? (
                  <div>
                    <p className="text-sm text-gray-500">Expires</p>
                    <p className="font-mono">{vaExpireAt}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      Transfer window: <b>{VA_EXPIRY_MINUTES} minutes</b>{" "}
                      {VA_EXPIRY_MINUTES % 60 === 0 ? (
                        <span className="text-gray-500">
                          ({VA_EXPIRY_MINUTES / 60} hour
                          {VA_EXPIRY_MINUTES / 60 === 1 ? "" : "s"})
                        </span>
                      ) : null}
                      {vaRemainingLabel ? (
                        <>
                          {" "}
                          •{" "}
                          <span className="font-semibold">
                            {vaRemainingLabel}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <div />
                )}

                <p className="text-xs text-gray-500">
                  Transfer the exact amount to this account, then click{" "}
                  <b>I have paid (Confirm)</b>.
                </p>
              </div>

              <div className="mt-5 flex justify-end gap-2 flex-wrap">
                <button
                  onClick={() => handleCopy(virtualAccount.vNUBAN)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold transition inline-flex items-center gap-2"
                >
                  <FaCopy /> Copy
                </button>

                <button
                  onClick={reconcileOrderPayment}
                  disabled={reconLoading}
                  className={`${
                    reconLoading
                      ? "bg-gray-400"
                      : "bg-green-700 hover:bg-green-800"
                  } text-white px-4 py-2 rounded-lg font-semibold transition`}
                >
                  {reconLoading ? "Checking..." : "I have paid (Confirm)"}
                </button>

                {!isPaymentOnlyMode ? (
                  <button
                    onClick={handleCancelPendingPayment}
                    className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg font-semibold transition"
                  >
                    Cancel Pending
                  </button>
                ) : null}

                <button
                  onClick={() => {
                    setShowVAModal(false);
                    setVirtualAccount(null);
                    setVaExpireAt(null);
                    setActivePaymentProvider("");
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ✅ Smooth Professional Success Modal */}
        {showThankYouModal && (
          <div
            role="dialog"
            aria-modal="true"
            className={`fixed inset-0 z-[999] flex items-center justify-center px-4 overflow-y-auto ${thankYouData?.provider === "PAYSTACK_DVA" ? "bg-gray-50" : ""}`}
            style={{ animation: "tyFadeIn 180ms ease-out both" }}
          >
            <div
              className={`fixed inset-0 ${thankYouData?.provider === "PAYSTACK_DVA" ? "bg-gray-50" : "bg-black/70"}`}
              onClick={handleThankYouOk}
              style={{ animation: "tyBackdrop 220ms ease-out both" }}
            />

            <div
              className="relative w-full max-w-md mx-auto overflow-hidden rounded-3xl bg-white shadow-2xl border border-white/70"
              style={{ animation: "tyPop 360ms cubic-bezier(.2,.9,.2,1) both" }}
            >
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-green-500 via-emerald-500 to-lime-400" />
              <div className="absolute -top-20 -right-20 w-44 h-44 rounded-full bg-green-100 opacity-80" />
              <div className="absolute -bottom-20 -left-20 w-44 h-44 rounded-full bg-emerald-50 opacity-90" />

              <button
                onClick={handleThankYouOk}
                className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 flex items-center justify-center transition"
                aria-label="Close"
              >
                <FaTimes />
              </button>

              <div className="relative px-6 pt-9 pb-7 sm:px-8 sm:pt-10 sm:pb-8 text-center">
                <div
                  className="mx-auto mb-5 relative w-24 h-24 flex items-center justify-center"
                  style={{ animation: "tyFloat 2.2s ease-in-out infinite" }}
                >
                  <div
                    className="absolute inset-0 rounded-full bg-green-200"
                    style={{ animation: "tyRing 1100ms ease-out infinite" }}
                  />
                  <div
                    className="absolute inset-2 rounded-full bg-green-100"
                    style={{
                      animation: "tyRing 1100ms ease-out infinite 180ms",
                    }}
                  />
                  <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center text-white shadow-xl shadow-green-200">
                    <FaCheck
                      className="text-3xl"
                      style={{ animation: "tyCheck 420ms ease-out both 160ms" }}
                    />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-bold uppercase tracking-wide mb-3">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Confirmed
                </div>

                <h3 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
                  {thankYouData?.partial ? "Part Payment Received" : "Payment Received"}
                </h3>

                <p className="text-gray-600 mt-3 leading-relaxed">
                  We’ve successfully received your{" "}
                  <span className="font-semibold text-gray-900">
                    {thankYouData?.mode === "shipment"
                      ? "shipment payment"
                      : thankYouData?.mode === "balance"
                        ? "balance payment"
                        : "order payment"}
                  </span>{" "}
                  of{" "}
                  <span className="font-bold text-green-700">
                    {formatNaira(thankYouData?.amount)}
                  </span>
                  .
                </p>

                <div className="w-full mt-6 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-left shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-500">
                      Order Reference
                    </span>
                    <span className="text-sm font-mono text-gray-900 text-right break-all">
                      {thankYouData?.orderId || "—"}
                    </span>
                  </div>

                  <div className="h-px bg-gray-200 my-3" />

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-500">Payment Type</span>
                    <span className="text-sm font-semibold text-gray-900 text-right">
                      {thankYouData?.mode === "shipment"
                        ? "Shipment Fee"
                        : thankYouData?.mode === "balance"
                          ? "Balance Payment"
                          : "Order Payment"}
                    </span>
                  </div>
                </div>

                {thankYouData?.partial && (
                  <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    Outstanding balance: <strong>{formatNaira(thankYouData.outstanding)}</strong>.
                    Your order is saved. Continue to pay the remaining balance.
                  </p>
                )}

                <div className="mt-5 rounded-2xl bg-green-50 border border-green-100 px-4 py-3 text-green-800 text-sm leading-relaxed">
                  {thankYouData?.partial
                    ? "Your part payment has been recorded against this order."
                    : "Thank you for your patronage. Your order record has been updated and processing can continue immediately."}
                </div>

                <div className="mt-6 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-600"
                    style={{ animation: "tyProgress 2.8s linear both" }}
                  />
                </div>

                <button
                  onClick={handleThankYouOk}
                  className="mt-5 w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white py-3.5 rounded-2xl font-bold transition shadow-lg shadow-green-100"
                >
                  {thankYouData?.partial ? "Pay remaining balance" : "Continue"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ✅ Persistent Failure Modal */}
        {showPaymentFailureModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[999] flex items-center justify-center px-4"
          >
            <div
              className="fixed inset-0 bg-black/70"
              onClick={handlePaymentFailureOk}
            />

            <div className="relative w-full max-w-md mx-auto overflow-hidden rounded-3xl bg-white shadow-2xl border border-white/70">
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-red-500 via-rose-500 to-orange-400" />

              <button
                onClick={handlePaymentFailureOk}
                className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 flex items-center justify-center transition"
                aria-label="Close"
              >
                <FaTimes />
              </button>

              <div className="relative px-6 pt-9 pb-7 sm:px-8 sm:pt-10 sm:pb-8 text-center">
                <div className="mx-auto mb-5 w-20 h-20 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                  <FaTimes className="text-3xl" />
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold uppercase tracking-wide mb-3">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Not Confirmed
                </div>

                <h3 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
                  Payment Not Confirmed
                </h3>

                <p className="text-gray-600 mt-3 leading-relaxed">
                  {paymentFailureData?.message ||
                    "We could not confirm this payment yet."}
                </p>

                <div className="w-full mt-6 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-left shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-500">
                      Order Reference
                    </span>
                    <span className="text-sm font-mono text-gray-900 text-right break-all">
                      {paymentFailureData?.orderId || "—"}
                    </span>
                  </div>

                  <div className="h-px bg-gray-200 my-3" />

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-500">Payment Type</span>
                    <span className="text-sm font-semibold text-gray-900 text-right">
                      {paymentFailureData?.mode === "shipment"
                        ? "Shipment Fee"
                        : paymentFailureData?.mode === "balance"
                          ? "Balance Payment"
                          : "Order Payment"}
                    </span>
                  </div>

                  <div className="h-px bg-gray-200 my-3" />

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-500">Amount</span>
                    <span className="text-sm font-bold text-gray-900 text-right">
                      {formatNaira(paymentFailureData?.amount)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={handlePaymentFailureOk}
                  className="mt-6 w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white py-3.5 rounded-2xl font-bold transition shadow-lg shadow-red-100"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutPage;
