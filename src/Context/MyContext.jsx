import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import {
  collection,
  onSnapshot,
  getDocs,
  getDoc,
  serverTimestamp,
  setDoc,
  doc,
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { db } from "../firebase";


// ------------------------------------------------------------
// FOLANGE-ONLY FIRESTORE PATH HELPERS
// ------------------------------------------------------------
import {
  FOLANGE_STORE_ID,
  FOLANGE_BROWSER_KEYS,
  folangeCollectionPath,
  folangeUserPath,
  folangeUserOrdersPath,
  folangeUserOrderPath,
  isFolangeOrderPath,
} from "../config/folangePaths";

const folangeProductsCollectionRef = () =>
  collection(db, ...folangeCollectionPath("cookingitems"));

const folangeUsersCollectionRef = () =>
  collection(db, ...folangeCollectionPath("users"));

const folangeUserRef = (uid) =>
  doc(db, ...folangeUserPath(uid));

const folangeUserOrdersCollectionRef = (uid) =>
  collection(db, ...folangeUserOrdersPath(uid));

// Ignore any path embedded in a record that belongs to another store.
const safeFolangeOrderPath = (path, uid, orderId) => {
  if (isFolangeOrderPath(path)) return path;
  if (uid && orderId) return folangeUserOrderPath(uid, orderId).join("/");
  return "";
};

const MyContext = createContext();
export const useMyContext = () => useContext(MyContext);

const initialState = {
  cart: [],
  isCartOpen: false,
};

export const MyContextProvider = ({ children }) => {
  // ------------------------------------------------------------
  // ✅ FIX: ensure cart items ALWAYS have variants + variantText
  // ------------------------------------------------------------

  const buildVariantsFromSelection = (item) => {
    const color = item?.selectedColor ? String(item.selectedColor).trim() : "";
    const size = item?.selectedSize ? String(item.selectedSize).trim() : "";

    const variantsObj =
      color || size
        ? {
            ...(color ? { color } : {}),
            ...(size ? { size } : {}),
          }
        : null;

    const variantText =
      variantsObj && Object.keys(variantsObj).length
        ? Object.entries(variantsObj)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "";

    return { variants: variantsObj, variantText };
  };

  const normalizeCartItem = (item) => {
    if (!item) return item;

    if (item.variants !== undefined && item.variantText !== undefined)
      return item;

    const { variants, variantText } = buildVariantsFromSelection(item);

    return {
      ...item,
      variants: item.variants ?? variants,
      variantText: item.variantText ?? variantText,
    };
  };

  // Persist cart
  const [state, setState] = useState(() => {
    try {
      const savedCart = localStorage.getItem(FOLANGE_BROWSER_KEYS.cart);
      if (!savedCart) return initialState;

      const parsed = JSON.parse(savedCart);

      const normalized = Array.isArray(parsed)
        ? parsed.map(normalizeCartItem)
        : [];

      return { ...initialState, cart: normalized };
    } catch {
      return initialState;
    }
  });

  useEffect(() => {
    safeLocalStorageSet(FOLANGE_BROWSER_KEYS.cart, JSON.stringify(state.cart));
  }, [state.cart]);

  const [cookingitems, setCookingItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const previousTransactionStatus = useRef({});

  const [orders, setOrders] = useState([]);
  const adminOrdersFetchPromiseRef = useRef(null);
  const hasLoadedFullAdminOrdersRef = useRef(false);
  const [trackingStages, setTrackingStages] = useState([]);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [currentCategory, setCurrentCategory] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [matchedItem, setMatchedItem] = useState(null);
  const [shipmentItems, setShipmentItems] = useState([]);

  const [wishlist, setWishlist] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // ✅ GLOBAL DASHBOARD MODALS
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);

  const [paymentType, setPaymentType] = useState("order");

  const auth = getAuth();

  const [shipmentFees, setShipmentFees] = useState([]);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [newAccount, setNewAccount] = useState(null);

  const [notes, setNotes] = useState([]);

  // ✅ GLOBAL DASHBOARD MODAL HELPERS
  const closeAllDashboardModals = () => {
    setShowOrdersModal(false);
    setShowInventoryModal(false);
    setShowSalesModal(false);
    setShowUsersModal(false);
    setShowPaymentsModal(false);

    try {
      document.body.style.overflow = "";
    } catch {}
  };

  const openDashboardModal = (type) => {
    closeAllDashboardModals();

    if (type === "orders") setShowOrdersModal(true);
    else if (type === "inventory") setShowInventoryModal(true);
    else if (type === "sales") setShowSalesModal(true);
    else if (type === "users") setShowUsersModal(true);
    else if (type === "payments") setShowPaymentsModal(true);
  };

  const isAnyDashboardModalOpen =
    showOrdersModal ||
    showInventoryModal ||
    showSalesModal ||
    showUsersModal ||
    showPaymentsModal;

  // ---------- helper ----------
  const normalize = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  // ------------------------------------------------------------
  // ✅ LOCALSTORAGE SAFETY HELPERS
  // ------------------------------------------------------------
  // localStorage has a small browser quota. Admin orders can become too large
  // because every order may contain cart images, payloads, inflow objects, etc.
  // These helpers prevent QuotaExceededError from breaking order loading.
  const safeLocalStorageSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn(
        `localStorage save skipped for ${key}:`,
        err?.message || err,
      );

      try {
        localStorage.removeItem(key);
      } catch {}

      return false;
    }
  };

  const safeLocalStorageRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  };

  const safeParseJson = (value, fallback = null) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  };

  const dateValueToMillis = (value) => {
    if (!value) return 0;

    if (typeof value?.toMillis === "function") {
      try {
        return value.toMillis();
      } catch {
        return 0;
      }
    }

    if (typeof value?.toDate === "function") {
      try {
        return value.toDate().getTime();
      } catch {
        return 0;
      }
    }

    if (typeof value === "object" && typeof value.seconds === "number") {
      return value.seconds * 1000 + Number(value.nanoseconds || 0) / 1000000;
    }

    if (typeof value === "number") return value;

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getOrderCreatedTime = (order = {}) =>
    dateValueToMillis(order?.createdAt) ||
    dateValueToMillis(order?.orderDate) ||
    dateValueToMillis(order?.date) ||
    dateValueToMillis(order?.updatedAt) ||
    0;

  const sortOrdersNewestFirst = (ordersToSort = []) =>
    [...ordersToSort].sort((a, b) => {
      const dateDifference = getOrderCreatedTime(b) - getOrderCreatedTime(a);
      if (dateDifference !== 0) return dateDifference;
      return String(b?.id || "").localeCompare(String(a?.id || ""));
    });

  const compactDateValue = (value) => {
    if (!value) return null;

    if (typeof value === "string" || typeof value === "number") return value;

    if (typeof value?.toDate === "function") {
      try {
        return value.toDate().toISOString();
      } catch {
        return null;
      }
    }

    if (
      typeof value === "object" &&
      typeof value.seconds === "number" &&
      typeof value.nanoseconds === "number"
    ) {
      return {
        seconds: value.seconds,
        nanoseconds: value.nanoseconds,
      };
    }

    return null;
  };

  const compactCustomer = (customer = {}, fallback = {}) => ({
    name: customer?.name || fallback?.name || "",
    email: customer?.email || fallback?.email || "",
    phone: customer?.phone || fallback?.phone || "",
    address: customer?.address || fallback?.address || "",
  });

  const compactShippingAddress = (shippingAddress = {}) => ({
    title: shippingAddress?.title || "",
    firstName: shippingAddress?.firstName || "",
    lastName: shippingAddress?.lastName || "",
    phone: shippingAddress?.phone || "",
    email: shippingAddress?.email || "",
    address: shippingAddress?.address || "",
    fullAddress: shippingAddress?.fullAddress || "",
    city: shippingAddress?.city || "",
    state: shippingAddress?.state || "",
    country: shippingAddress?.country || "",
  });

  const compactCartItem = (item = {}) => ({
    id: item?.id || "",
    productId: item?.productId || item?.productID || item?.parentId || "",
    parentId: item?.parentId || "",
    name: item?.name || item?.title || item?.productName || "Item",
    title: item?.title || "",
    productName: item?.productName || "",
    category: item?.category || "",
    status: item?.status || "",
    price: Number(item?.price || 0),
    quantity: Number(item?.quantity || item?.qty || 0),
    selectedColor: item?.selectedColor || item?.color || "",
    selectedSize: item?.selectedSize || item?.size || "",
    variants: item?.variants || null,
    variant: item?.variant || null,
    variantText: item?.variantText || "",
  });

  const compactInflow = (inflow = null) => {
    if (!inflow || typeof inflow !== "object") return null;

    return {
      paidTotal: Number(inflow?.paidTotal || 0),
      amount: Number(inflow?.amount || 0),
      amountNormalized: Number(inflow?.amountNormalized || 0),
      amountPaid: Number(inflow?.amountPaid || inflow?.["amount paid"] || 0),
      outstanding: Number(inflow?.outstanding || 0),
      expected: Number(inflow?.expected || 0),
      beneficiaryAccountNumber:
        inflow?.beneficiaryAccountNumber ||
        inflow?.creditAccount ||
        inflow?.accountNumber ||
        inflow?.destinationAccount ||
        "",
      reference: inflow?.reference || "",
      source: inflow?.source || "",
      restoredByAdmin: !!inflow?.restoredByAdmin,
    };
  };

  const compactPaymentObject = (payment = {}) => ({
    status: payment?.status || "",
    state: payment?.state || "",
    amount: Number(payment?.amount || 0),
    payableTotal: Number(payment?.payableTotal || 0),
    amountPaid: Number(payment?.amountPaid || 0),
    currency: payment?.currency || "",
    provider: payment?.provider || "",
    reference: payment?.reference || "",
    paymentRef: payment?.paymentRef || "",
    paidIntoAccount: payment?.paidIntoAccount || "",
    vaNuban:
      payment?.vaNuban ||
      payment?.vaNUBAN ||
      payment?.vNuban ||
      payment?.vNUBAN ||
      "",
    paidAt: compactDateValue(payment?.paidAt),
    initiatedAt: compactDateValue(payment?.initiatedAt),
    inflow: compactInflow(payment?.inflow || null),
    rawPayload: payment?.rawPayload
      ? {
          source: payment.rawPayload?.source || "",
          amount: Number(payment.rawPayload?.amount || 0),
          baseToPay: Number(payment.rawPayload?.baseToPay || 0),
          payableBase: Number(payment.rawPayload?.payableBase || 0),
          payableTotal: Number(payment.rawPayload?.payableTotal || 0),
          vatAmount: Number(payment.rawPayload?.vatAmount || 0),
          vatRate: Number(payment.rawPayload?.vatRate || 0),
          vatCap: Number(payment.rawPayload?.vatCap || 0),
        }
      : null,
  });

  const compactSubPayment = (section = {}) => ({
    enabled: !!section?.enabled,
    state: section?.state || "",
    amount: Number(section?.amount || 0),
    payableTotal: Number(section?.payableTotal || 0),
    amountPaid: Number(section?.amountPaid || 0),
    outstanding: Number(section?.outstanding || 0),
    paidAt: compactDateValue(section?.paidAt),
    enabledAt: compactDateValue(section?.enabledAt),
    payment: compactPaymentObject(section?.payment || {}),
    inflow: compactInflow(section?.inflow || null),
  });

  const compactOrderForCache = (order = {}) => ({
    id: order?.id || "",
    storeId: FOLANGE_STORE_ID,
    userId: order?.userId || "",
    orderPath:
      safeFolangeOrderPath(order?.orderPath, order?.userId, order?.id),
    orderStatus: order?.orderStatus || "",
    status: order?.status || "",
    userName: order?.userName || "",
    userEmail: order?.userEmail || "",
    createdAt: compactDateValue(order?.createdAt),
    updatedAt: compactDateValue(order?.updatedAt),
    totalAmount: Number(order?.totalAmount || 0),
    grandTotal: Number(order?.grandTotal || 0),
    payableTotal: Number(order?.payableTotal || 0),
    shipmentFee: Number(order?.shipmentFee || 0),
    orderFingerprint: order?.orderFingerprint || "",
    customer: compactCustomer(order?.customer || {}, {
      name: order?.userName || "",
      email: order?.userEmail || "",
    }),
    shippingAddress: compactShippingAddress(order?.shippingAddress || {}),
    cart: Array.isArray(order?.cart)
      ? order.cart.slice(0, 30).map(compactCartItem)
      : [],
    payment: compactPaymentObject(order?.payment || {}),
    balancePayment: order?.balancePayment
      ? compactSubPayment(order.balancePayment)
      : null,
    shipmentPayment: order?.shipmentPayment
      ? compactSubPayment(order.shipmentPayment)
      : null,
    vat: order?.vat
      ? {
          amount: Number(order.vat?.amount || 0),
          cap: Number(order.vat?.cap || 0),
          rate: Number(order.vat?.rate || 0),
        }
      : null,
    tracking: order?.tracking
      ? {
          stage: order.tracking?.stage || "",
          updatedAt: compactDateValue(order.tracking?.updatedAt),
        }
      : null,
    trackingStage: order?.trackingStage || "",
  });

  const saveAdminOrdersCache = (cacheKey, cacheTimeKey, ordersToCache = []) => {
    const attempts = [500, 300, 150, 75, 25];

    for (const limit of attempts) {
      const slimOrders = (ordersToCache || [])
        .slice(0, limit)
        .map(compactOrderForCache);
      const ok = safeLocalStorageSet(cacheKey, JSON.stringify(slimOrders));

      if (ok) {
        safeLocalStorageSet(cacheTimeKey, Date.now().toString());
        return true;
      }
    }

    safeLocalStorageRemove(cacheKey);
    safeLocalStorageRemove(cacheTimeKey);
    return false;
  };

  // ------------------------------------------------------------
  // ✅ STOCK HELPERS
  // ------------------------------------------------------------

  const getName = (maybeObjOrString) =>
    typeof maybeObjOrString === "string"
      ? maybeObjOrString
      : (maybeObjOrString?.name ?? null);

  const sumRestockedForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.restockHistory || !Array.isArray(item.restockHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase();

    return item.restockHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase() === nameLower)
          return true;
        if (r.size && r.size.toString().toLowerCase() === nameLower)
          return true;
        if (
          r.variantName &&
          r.variantName.toString().toLowerCase() === nameLower
        )
          return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower))
          return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  };

  const sumSoldForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.soldHistory || !Array.isArray(item.soldHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase();

    return item.soldHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase() === nameLower)
          return true;
        if (r.size && r.size.toString().toLowerCase() === nameLower)
          return true;
        if (
          r.variantName &&
          r.variantName.toString().toLowerCase() === nameLower
        )
          return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower))
          return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  };

  const hasVariants = (item) =>
    (Array.isArray(item?.colors) && item.colors.length > 0) ||
    (Array.isArray(item?.sizes) && item.sizes.length > 0);

  const getAllVariantNames = (item) => {
    const colorNames = (Array.isArray(item?.colors) ? item.colors : [])
      .map((c) => getName(c))
      .filter(Boolean);

    const sizeNames = (Array.isArray(item?.sizes) ? item.sizes : [])
      .map((s) => getName(s))
      .filter(Boolean);

    return Array.from(new Set([...colorNames, ...sizeNames]));
  };

  const computeTotalStock = (item) => {
    if (!item) return 0;

    if (hasVariants(item)) {
      const variants = getAllVariantNames(item);
      if (variants.length === 0) return 0;

      return variants.reduce((acc, name) => {
        const restocked = sumRestockedForVariant(item, name);
        const sold = sumSoldForVariant(item, name);
        return acc + Math.max(0, restocked - sold);
      }, 0);
    }

    const restockedTop = Array.isArray(item?.restockHistory)
      ? item.restockHistory.reduce((s, e) => s + (Number(e?.quantity) || 0), 0)
      : null;

    const soldTop = Array.isArray(item?.soldHistory)
      ? item.soldHistory.reduce((s, e) => s + (Number(e?.quantity) || 0), 0)
      : null;

    if (restockedTop !== null || soldTop !== null) {
      return Math.max(0, (restockedTop || 0) - (soldTop || 0));
    }

    return Number(item.quantity || 0);
  };

  const getVariantQuantity = (
    item,
    colorName,
    sizeName,
    lastSelection = null,
  ) => {
    if (!item) return 0;

    if (!hasVariants(item)) {
      return computeTotalStock(item);
    }

    let variantName = null;

    if (lastSelection === "size") {
      variantName = (sizeName && sizeName.toString().trim()) || null;
      if (!variantName)
        variantName = (colorName && colorName.toString().trim()) || null;
    } else if (lastSelection === "color") {
      variantName = (colorName && colorName.toString().trim()) || null;
      if (!variantName)
        variantName = (sizeName && sizeName.toString().trim()) || null;
    } else {
      variantName =
        (colorName && colorName.toString().trim()) ||
        (sizeName && sizeName.toString().trim()) ||
        null;
    }

    if (variantName) {
      const restocked = sumRestockedForVariant(item, variantName);
      const sold = sumSoldForVariant(item, variantName);
      return Math.max(0, restocked - sold);
    }

    return computeTotalStock(item);
  };

  // ------------------------------------------------------------
  // ✅ CART STOCK CONTROL HELPERS
  // ------------------------------------------------------------

  const clampQty = (qty, stock) => {
    const q = Number(qty || 1);
    const s = Number(stock || 0);
    if (!Number.isFinite(q) || q <= 0) return 1;
    if (!Number.isFinite(s) || s <= 0) return 1;
    return Math.min(q, s);
  };

  const getParentItemFromCart = (cartItem) => {
    const parentId = cartItem?.parentId || cartItem?.id;
    return (cookingitems || []).find((p) => p.id === parentId) || null;
  };

  const getCartItemStock = (cartItem) => {
    const parent = getParentItemFromCart(cartItem);
    if (!parent) return 0;
    return getVariantQuantity(
      parent,
      cartItem.selectedColor,
      cartItem.selectedSize,
    );
  };

  const updateCartQty = (id, nextQty) =>
    setState((p) => ({
      ...p,
      cart: p.cart.map((item) =>
        item.id === id
          ? normalizeCartItem({
              ...item,
              quantity: Math.max(1, Number(nextQty || 1)),
            })
          : item,
      ),
    }));

  useEffect(() => {
    if (!state.cart || state.cart.length === 0) return;

    setState((p) => {
      let changed = false;

      const nextCart = p.cart.map((ci) => {
        const stock = getCartItemStock(ci);
        const clamped = clampQty(ci.quantity, stock);

        if (Number(ci.quantity) !== Number(clamped)) changed = true;

        return normalizeCartItem({ ...ci, quantity: clamped });
      });

      return changed ? { ...p, cart: nextCart } : p;
    });
  }, [cookingitems]);

  // -------------------------------------------
  // AUTH & USER DOCUMENT
  // -------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoadingUser(true);

      if (u) {
        try {
          const userRef = folangeUserRef(u.uid);
          const snap = await getDoc(userRef);

          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: u.uid,
              email: u.email,
              name: u.displayName || "New User",
              role: "customer",
              createdAt: serverTimestamp(),
            });
          }

          const userData = snap.exists()
            ? snap.data()
            : { role: "customer", name: u.displayName || "New User" };

          const userWithRole = {
            uid: u.uid,
            email: u.email,
            name: userData.name,
            role: userData.role,
          };

          setCurrentUser(userWithRole);
        } catch (err) {
          console.error("Error loading user:", err);
        }
      } else {
        setCurrentUser(null);
        hasLoadedFullAdminOrdersRef.current = false;
        adminOrdersFetchPromiseRef.current = null;
        setOrders([]);
        setTransactions([]);
      }

      setLoadingUser(false);
    });

    return unsub;
  }, [auth]);

  const isAdmin = currentUser?.role === "admin";
  const isCustomer = currentUser?.role === "customer";
  const isVisitor = !currentUser;

  // -------------------------------------------
  // SIGN UP / SIGN IN / SIGN OUT
  // -------------------------------------------

  const handleSignUp = async (email, password, name) => {
    const res = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(folangeUserRef(res.user.uid), {
      uid: res.user.uid,
      email,
      name,
      role: "customer",
      createdAt: serverTimestamp(),
    });
  };

  const handleSignIn = async (email, password) => {
    return await signInWithEmailAndPassword(auth, email, password);
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    const userRef = folangeUserRef(result.user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: result.user.uid,
        email: result.user.email,
        name: result.user.displayName,
        role: "customer",
        createdAt: serverTimestamp(),
      });
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleForgotPassword = async (email) => {
    await sendPasswordResetEmail(auth, email);
  };

  // -------------------------------------------
  // WISHLIST
  // -------------------------------------------

  const loadWishlist = async () => {};

  useEffect(() => {
    if (!loadingUser) loadWishlist();
  }, [currentUser, loadingUser]);

  const toggleWishlist = async (item) => {};

  const isInWishlist = (id) => wishlist.some((w) => w.id === id);

  // -------------------------------------------
  // NOTES
  // ✅ load only when needed, cache to reduce reads
  // -------------------------------------------

  const refreshNotes = useCallback(async (force = false) => {
    try {
      const cacheKey = "folange_notes_cache";
      const cacheTimeKey = "folange_notes_cache_time";
      const cacheDuration = 1000 * 60 * 10;

      const cached = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(cacheTimeKey);

      if (!force && cached && cachedTime) {
        const isFresh = Date.now() - Number(cachedTime) < cacheDuration;
        if (isFresh) {
          setNotes(JSON.parse(cached));
          return;
        }
      }

      const snap = await getDocs(collection(db, ...folangeCollectionPath("Notes")));
      const notesData = snap.docs.map((docu) => ({
        id: docu.id,
        ...docu.data(),
      }));

      setNotes(notesData);
      safeLocalStorageSet(cacheKey, JSON.stringify(notesData));
      safeLocalStorageSet(cacheTimeKey, Date.now().toString());
    } catch (err) {
      console.error("Error loading notes:", err);
    }
  }, []);

  // -------------------------------------------
  // TRANSACTIONS
  // ✅ load only when Payments opens, cache to reduce reads
  // -------------------------------------------

  const refreshTransactions = useCallback(async (force = false) => {
    try {
      const cacheKey = "folange_transactions_cache";
      const cacheTimeKey = "folange_transactions_cache_time";
      const cacheDuration = 1000 * 60 * 5;

      const cached = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(cacheTimeKey);

      if (!force && cached && cachedTime) {
        const isFresh = Date.now() - Number(cachedTime) < cacheDuration;
        if (isFresh) {
          const txs = JSON.parse(cached);
          setTransactions(txs);
          return;
        }
      }

      const snap = await getDocs(collection(db, ...folangeCollectionPath("transactions")));
      const txs = snap.docs.map((docu) => ({
        id: docu.id,
        ...docu.data(),
      }));

      txs.forEach((tx) => {
        const prevStatus = previousTransactionStatus.current[tx.id];
        if (prevStatus && prevStatus !== tx.status) {
          alert(
            `Payment Update\n\nRef: ${tx.transaction_ref}\n${prevStatus} → ${tx.status}`,
          );
        }
        previousTransactionStatus.current[tx.id] = tx.status;
      });

      setTransactions(txs);
      safeLocalStorageSet(cacheKey, JSON.stringify(txs));
      safeLocalStorageSet(cacheTimeKey, Date.now().toString());
    } catch (err) {
      console.error("Error loading transactions:", err);
    }
  }, []);

  // -------------------------------------------
  // FOLANGE PRODUCTS + TRACKING
  // ✅ localStorage cache + one-time fetch
  // -------------------------------------------

  const refreshCookingItems = useCallback(async (force = false) => {
    try {
      const cacheKey = FOLANGE_BROWSER_KEYS.productsCache;
      const cacheTimeKey = FOLANGE_BROWSER_KEYS.productsCacheTime;
      const cacheDuration = 1000 * 60 * 10;

      const cachedItems = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(cacheTimeKey);

      if (!force && cachedItems && cachedTime) {
        const isFresh = Date.now() - Number(cachedTime) < cacheDuration;

        if (isFresh) {
          const items = JSON.parse(cachedItems);

          setCookingItems(items);
          setShipmentItems(
            items.filter(
              (i) => i.shipmentFee && normalize(i.status) === "preorder",
            ),
          );
          setTrackingStages(
            items
              .filter((i) => i.trackingStage)
              .map((i) => ({
                id: i.id,
                name: i.name,
                trackingStage: i.trackingStage,
                status: i.status,
              })),
          );
          return;
        }
      }

      const snap = await getDocs(folangeProductsCollectionRef());
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      setCookingItems(items);

      setShipmentItems(
        items.filter(
          (i) => i.shipmentFee && normalize(i.status) === "preorder",
        ),
      );

      setTrackingStages(
        items
          .filter((i) => i.trackingStage)
          .map((i) => ({
            id: i.id,
            name: i.name,
            trackingStage: i.trackingStage,
            status: i.status,
          })),
      );

      safeLocalStorageSet(cacheKey, JSON.stringify(items));
      safeLocalStorageSet(cacheTimeKey, Date.now().toString());
    } catch (err) {
      console.error("Error loading cookingitems:", err);
    }
  }, []);

  useEffect(() => {
    // Always fetch fresh on load so newly added products are never hidden by the cache.
    refreshCookingItems(true);
  }, [refreshCookingItems]);

  // -------------------------------------------
  // ORDERS
  // ✅ customer keeps live snapshot
  // ✅ admin loads once on sign-in so dashboard cards display
  // ✅ admin refreshes again when Orders / Payments / Sales opens
  // ✅ cache is only a quick preview; Firestore always replaces it with all orders
  // ✅ loads every permitted folange/main/users/{uid}/orders subcollection
  // ✅ all results are sorted newest-first so recent orders remain visible
  // -------------------------------------------

  const refreshAdminOrders = useCallback(async (force = false) => {
    const cacheKey = "folange_admin_orders_cache";
    const cacheTimeKey = "folange_admin_orders_cache_time";
    const cacheDuration = 1000 * 60 * 2;

    try {
      // The localStorage cache intentionally contains at most 500 compact orders.
      // It must never be treated as the complete admin order list.
      if (!force && !hasLoadedFullAdminOrdersRef.current) {
        const cached = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);
        const isFresh =
          cached &&
          cachedTime &&
          Date.now() - Number(cachedTime) < cacheDuration;

        if (isFresh) {
          const parsedCachedOrders = safeParseJson(cached, null);

          if (Array.isArray(parsedCachedOrders)) {
            setOrders(sortOrdersNewestFirst(parsedCachedOrders));
          } else {
            safeLocalStorageRemove(cacheKey);
            safeLocalStorageRemove(cacheTimeKey);
          }
        }
      }

      // If two admin effects request orders together, share one Firestore fetch.
      // This prevents duplicate reads without allowing the 500-item cache to win.
      if (adminOrdersFetchPromiseRef.current) {
        return await adminOrdersFetchPromiseRef.current;
      }

      const fetchAllOrders = (async () => {
        const usersSnap = await getDocs(folangeUsersCollectionRef());

        const ordersByUser = await Promise.all(
          usersSnap.docs.map(async (userDoc) => {
            const userId = userDoc.id;
            const ordersSnap = await getDocs(
              folangeUserOrdersCollectionRef(userId),
            );

            return ordersSnap.docs.map((orderDoc) => {
              const orderData = orderDoc.data();

              return {
                ...orderData,
                id: orderDoc.id,
                userId: orderData?.userId || userId,
                orderPath: orderDoc.ref.path,
                storeId: FOLANGE_STORE_ID,
              };
            });
          }),
        );

        const allOrders = ordersByUser.flat();

        const sortedOrders = sortOrdersNewestFirst(allOrders);

        hasLoadedFullAdminOrdersRef.current = true;
        setOrders(sortedOrders);
        saveAdminOrdersCache(cacheKey, cacheTimeKey, sortedOrders);

        return sortedOrders;
      })();

      adminOrdersFetchPromiseRef.current = fetchAllOrders;

      try {
        return await fetchAllOrders;
      } finally {
        if (adminOrdersFetchPromiseRef.current === fetchAllOrders) {
          adminOrdersFetchPromiseRef.current = null;
        }
      }
    } catch (err) {
      console.error("Error loading all admin orders:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) return;

    if (currentUser.role === "admin") {
      refreshAdminOrders();
      return;
    }

    const unsubscribe = onSnapshot(
      folangeUserOrdersCollectionRef(currentUser.uid),
      (snapshot) => {
        const userOrders = snapshot.docs.map((docu) => {
          const orderData = docu.data();

          return {
            ...orderData,
            id: docu.id,
            userId: orderData?.userId || currentUser.uid,
            orderPath: docu.ref.path,
            storeId: FOLANGE_STORE_ID,
          };
        });

        setOrders(sortOrdersNewestFirst(userOrders));
      },
    );

    return () => unsubscribe();
  }, [currentUser, refreshAdminOrders]);

  // ✅ admin orders refresh when Orders / Payments / Sales opens
  const adminDataViewOpen =
    showOrdersModal || showPaymentsModal || showSalesModal;

  useEffect(() => {
    if (!currentUser?.uid) return;
    if (currentUser.role !== "admin") return;
    if (!adminDataViewOpen) return;

    refreshAdminOrders(true);
  }, [currentUser, adminDataViewOpen, refreshAdminOrders]);

  // ✅ transactions load only when payments opens
  useEffect(() => {
    if (!currentUser?.uid) return;
    if (currentUser.role !== "admin") return;
    if (!showPaymentsModal) return;

    refreshTransactions();
  }, [currentUser, showPaymentsModal, refreshTransactions]);

  const updateOrderInContext = (orderId, field, value) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, [field]: value } : o)),
    );
  };

  // -------------------------------------------
  // CART
  // -------------------------------------------

  const toggleCart = () =>
    setState((p) => ({ ...p, isCartOpen: !p.isCartOpen }));

  const addToCart = (product, customPrice) =>
    setState((prev) => {
      const normalizedProduct = normalizeCartItem(product);

      const incomingQty = Math.max(1, Number(normalizedProduct?.quantity || 1));
      const existing = prev.cart.find((i) => i.id === normalizedProduct.id);

      const isPreOrder =
        normalize(normalizedProduct?.status || "") === "preorder";

      const parentId =
        normalizedProduct?.parentId ||
        normalizedProduct?.productId ||
        normalizedProduct?.id;

      const parent =
        (cookingitems || []).find((p) => p.id === parentId) || null;

      const availableStock = parent
        ? getVariantQuantity(
            parent,
            normalizedProduct.selectedColor,
            normalizedProduct.selectedSize,
          )
        : null;

      if (!isPreOrder && availableStock !== null && availableStock <= 0) {
        return prev;
      }

      if (existing) {
        const nextQty = Number(existing.quantity || 1) + incomingQty;

        if (
          !isPreOrder &&
          availableStock !== null &&
          nextQty > availableStock
        ) {
          return prev;
        }

        return {
          ...prev,
          cart: prev.cart.map((i) =>
            i.id === normalizedProduct.id
              ? normalizeCartItem({
                  ...i,
                  quantity: nextQty,
                  price: customPrice ?? i.price,
                })
              : i,
          ),
        };
      }

      if (
        !isPreOrder &&
        availableStock !== null &&
        incomingQty > availableStock
      ) {
        return prev;
      }

      return {
        ...prev,
        cart: [
          ...prev.cart,
          normalizeCartItem({
            ...normalizedProduct,
            price: customPrice ?? normalizedProduct.price,
            quantity: incomingQty,
          }),
        ],
      };
    });

  const removeFromCart = (id) =>
    setState((p) => ({ ...p, cart: p.cart.filter((i) => i.id !== id) }));

  const clearCart = () => {
    setState((p) => ({ ...p, cart: [] }));
    safeLocalStorageRemove(FOLANGE_BROWSER_KEYS.cart);
  };

  const increaseQuantity = (id) =>
    setState((p) => {
      const target = p.cart.find((x) => x.id === id);
      if (!target) return p;

      const isPreOrder = normalize(target?.status || "") === "preorder";
      if (isPreOrder) {
        return {
          ...p,
          cart: p.cart.map((item) =>
            item.id === id
              ? normalizeCartItem({ ...item, quantity: item.quantity + 1 })
              : item,
          ),
        };
      }

      const stock = getCartItemStock(target);
      const nextQty = Number(target.quantity || 1) + 1;

      if (stock > 0 && nextQty > stock) {
        return p;
      }

      return {
        ...p,
        cart: p.cart.map((item) =>
          item.id === id
            ? normalizeCartItem({ ...item, quantity: nextQty })
            : item,
        ),
      };
    });

  const decreaseQuantity = (id) =>
    setState((p) => ({
      ...p,
      cart: p.cart.map((item) =>
        item.id === id
          ? normalizeCartItem({
              ...item,
              quantity: Math.max(1, item.quantity - 1),
            })
          : item,
      ),
    }));

  // -------------------------------------------
  // FILTERED ITEMS
  // -------------------------------------------

  const normStatusFilter = normalize(statusFilter);

  const filteredCookingItems = cookingitems.filter((item) => {
    const matchCategory = !filterCategory || item.category === filterCategory;
    const matchSearch =
      !searchQuery ||
      item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category?.toLowerCase().includes(searchQuery.toLowerCase());

    if (normStatusFilter === "wishlist") {
      return (
        wishlist.some((w) => w.id === item.id) && matchCategory && matchSearch
      );
    }

    if (!normStatusFilter || normStatusFilter === "all") {
      return matchCategory && matchSearch;
    }

    const itemNorm = normalize(item.status);
    const matchStatus = itemNorm === normStatusFilter;
    return matchCategory && matchSearch && matchStatus;
  });

  // -------------------------------------------
  // SHIPMENT FEE
  // -------------------------------------------

  const addShipmentFee = (order) => {
    setShipmentFees((prev) => {
      const exists = prev.find((item) => item.orderId === order.id);
      if (exists) return prev;

      return [
        ...prev,
        {
          name: order.cart?.map((i) => i.name).join(", "),
          shipmentFee: order.shipmentFee || 0,
          orderId: order.id,
        },
      ];
    });
  };

  const clearShipmentFees = () => setShipmentFees([]);

  // -------------------------------------------
  // MODALS
  // -------------------------------------------

  const openCredentialsModal = (email, password) => {
    setNewAccount({ email, password });
    setShowCredentialsModal(true);
  };

  const closeCredentialsModal = () => {
    setNewAccount(null);
    setShowCredentialsModal(false);
  };

  // -------------------------------------------
  // UTILS
  // -------------------------------------------

  const capitalizeWords = (text) =>
    text?.replace(/\b\w/g, (c) => c.toUpperCase());

  // -------------------------------------------
  // PROVIDER
  // -------------------------------------------

  return (
    <MyContext.Provider
      value={{
        ...state,
        cookingitems,
        filteredCookingItems,
        matchedItem,
        orders,
        trackingStages,
        setTrackingStages,
        wishlist,
        isInWishlist,
        toggleWishlist,
        toggleCart,
        addToCart,
        removeFromCart,
        clearCart,
        increaseQuantity,
        decreaseQuantity,
        computeTotalStock,
        getVariantQuantity,
        getCartItemStock,
        updateCartQty,
        refreshCookingItems,
        refreshAdminOrders,
        refreshNotes,
        refreshTransactions,
        capitalizeWords,
        searchQuery,
        setSearchQuery,
        filterCategory,
        setFilterCategory,
        currentCategory,
        setCurrentCategory,
        statusFilter,
        setStatusFilter,
        currentUser,
        isAdmin,
        isCustomer,
        isVisitor,
        handleSignUp,
        handleSignIn,
        handleGoogleSignIn,
        handleSignOut,
        handleForgotPassword,
        loadingUser,
        showSignInModal,
        setShowSignInModal,
        showSignUpModal,
        setShowSignUpModal,
        shipmentItems,
        setShipmentItems,
        shipmentFees,
        addShipmentFee,
        clearShipmentFees,
        updateOrderInContext,
        showOrdersModal,
        setShowOrdersModal,
        showInventoryModal,
        setShowInventoryModal,
        showSalesModal,
        setShowSalesModal,
        showUsersModal,
        setShowUsersModal,
        showPaymentsModal,
        setShowPaymentsModal,
        closeAllDashboardModals,
        openDashboardModal,
        isAnyDashboardModalOpen,
        showCredentialsModal,
        newAccount,
        openCredentialsModal,
        closeCredentialsModal,
        notes,
        transactions,
        paymentType,
        setPaymentType,
      }}
    >
      {children}
    </MyContext.Provider>
  );
};