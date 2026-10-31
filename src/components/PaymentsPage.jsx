import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useMyContext } from "../Context/MyContext";
import { toast } from "react-toastify";
import { IoClose } from "react-icons/io5";
import { db } from "../firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  arrayUnion,
  writeBatch,
} from "firebase/firestore";

const PaymentsComponent = () => {
  const {
    orders = [],
    currentUser,
    shipmentItems = [],
    closeAllDashboardModals,
  } = useMyContext();


  const [fromDate, setFromDate] = useState(null);
  const [toDate, setToDate] = useState(null);

  // ✅ Search by customer name, phone, email, order ID, address, and item names
  const [searchKeyword, setSearchKeyword] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);

  const [stageDraft, setStageDraft] = useState("");
  const [trackById, setTrackById] = useState({});
  const [reconById, setReconById] = useState({});

  const [bulkToggleLoading, setBulkToggleLoading] = useState(false);
  const [bulkAllToggleState, setBulkAllToggleState] = useState(false);

  // ✅ Admin-only repair queue.
  // IMPORTANT: This does NOT scan ordinary pending orders.
  // It only reports a repair issue after Firestore paymentAudit proves
  // the payment section was previously PAID/PARTIAL with inflow/payment info,
  // then later sees either the existing status flip rule OR a missing inflow map.
  const [showRepairQueue, setShowRepairQueue] = useState(false);
  const [repairById, setRepairById] = useState({});
  const [paymentFlipLogByKey, setPaymentFlipLogByKey] = useState({});
  const [resolvedRepairKeys, setResolvedRepairKeys] = useState({});
  const [missingRepairRowsByKey, setMissingRepairRowsByKey] = useState({});

  const missingRepairFetchByKeyRef = useRef({});

  const isAdmin = currentUser?.role === "admin";

  const printPaymentsRef = useRef(null);
  const printReceiptRef = useRef(null);

  const TRACKING_STAGES = useMemo(
    () => ["Processing", "Out for delivery", "Stockpiled", "Picked up", "Delivered"],
    []
  );

  const PAYMENT_REPAIR_MODES = useMemo(() => ["order", "balance", "shipment"], []);

  useEffect(() => {
    if (selectedOrder) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev || "";
      };
    }
  }, [selectedOrder]);

  const forceCloseDashboardShell = useCallback(() => {
    if (typeof closeAllDashboardModals === "function") {
      try {
        closeAllDashboardModals();
      } catch (e) {
        console.warn("closeAllDashboardModals failed:", e?.message || e);
      }
    }
    try {
      window.dispatchEvent(new Event("close-all-dashboard-modals"));
    } catch {}
  }, [closeAllDashboardModals]);

  const closeEverything = useCallback(() => {
    setSelectedOrder(null);
    setStageDraft("");
    try {
      document.body.style.overflow = "";
    } catch {}
  }, []);

  const toDateObject = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    try {
      if (typeof val === "object" && typeof val.toDate === "function") {
        return val.toDate();
      }
      return new Date(val);
    } catch {
      return null;
    }
  };

  const formatDateShort = (val) => {
    const d = toDateObject(val);
    if (!d || isNaN(d)) return "—";
    return d.toLocaleDateString();
  };

  const formatTimeShort = (val) => {
    const d = toDateObject(val);
    if (!d || isNaN(d)) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const safeFormatDateTime = (val) => ({
    date: formatDateShort(val),
    time: formatTimeShort(val),
  });

  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

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

    const fromMap = cleanObj(item.variants);
    if (fromMap) return fromMap;

    const fromVariantMap = cleanObj(item.variant);
    if (fromVariantMap) return fromVariantMap;

    if (typeof item.variantText === "string" && item.variantText.trim()) {
      return { name: item.variantText.trim() };
    }

    const color = String(item.selectedColor || item.color || "").trim();
    const size = String(item.selectedSize || item.size || "").trim();

    if (color || size) {
      const out = {};
      if (color) out.color = color;
      if (size) out.size = size;
      return out;
    }

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
      .filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${v}`);
    return entries.length ? entries.join(", ") : "";
  };

  const getItemDisplayName = (item) => {
    const name = item?.name || item?.title || item?.productName || "Item";
    const vObj = normalizeVariants(item);
    const vText = formatVariantsText(vObj);
    return vText ? `${name} (${vText})` : name;
  };

  // ✅ Product-aware search helper
  // This makes the payment search find orders by product name, title,
  // productName, productId, SKU, slug, category, and variant text.
  const getCartItemSearchText = (item) => {
    if (!item) return "";

    const vObj = normalizeVariants(item);
    const variantText = formatVariantsText(vObj);

    const rawVariantValues = vObj && typeof vObj === "object"
      ? Object.values(vObj).join(" ")
      : "";

    return [
      getItemDisplayName(item),
      item?.name,
      item?.title,
      item?.productName,
      item?.productTitle,
      item?.displayName,
      item?.description,
      item?.category,
      item?.sku,
      item?.SKU,
      item?.slug,
      item?.productId,
      item?.productID,
      item?.id,
      item?.variant,
      item?.variantName,
      item?.variantText,
      item?.selectedColor,
      item?.selectedSize,
      item?.color,
      item?.size,
      variantText,
      rawVariantValues,
    ]
      .filter(Boolean)
      .join(" ");
  };

  const getCartItemQuantity = (item = {}) => {
    const qty =
      toNum(item?.quantity) ||
      toNum(item?.qty) ||
      toNum(item?.count) ||
      toNum(item?.cartQuantity) ||
      toNum(item?.selectedQuantity) ||
      0;

    return Math.max(0, qty);
  };

  const cartItemMatchesKeyword = (item = {}, keyword = "") => {
    const q = String(keyword || "").toLowerCase().trim();
    if (!q) return true;

    const itemSearchText = getCartItemSearchText(item).toLowerCase();
    return itemSearchText.includes(q);
  };

  const getOrderQtySoldForSearch = (order = {}, keyword = "") => {
    const cart = Array.isArray(order?.cart) ? order.cart : [];
    const q = String(keyword || "").toLowerCase().trim();

    if (!q) {
      return cart.reduce((sum, item) => sum + getCartItemQuantity(item), 0);
    }

    const matchedProductItems = cart.filter((item) => cartItemMatchesKeyword(item, q));

    // ✅ If the search keyword matches one or more products, count only those products.
    // ✅ If the keyword matches customer/order details instead, count all products in the filtered order.
    const qtySource = matchedProductItems.length > 0 ? matchedProductItems : cart;

    return qtySource.reduce((sum, item) => sum + getCartItemQuantity(item), 0);
  };

  const getVaNubanFromOrder = (o) => {
    const raw =
      o?.payment?.paidIntoAccount ||
      o?.payment?.vaNuban ||
      o?.payment?.vaNUBAN ||
      o?.payment?.vNuban ||
      o?.payment?.vNUBAN ||
      o?.shipmentPayment?.payment?.vaNuban ||
      o?.shipmentPayment?.payment?.vaNUBAN ||
      o?.balancePayment?.payment?.vaNuban ||
      o?.balancePayment?.payment?.vaNUBAN ||
      o?.inflow?.beneficiaryAccountNumber ||
      o?.payment?.inflow?.beneficiaryAccountNumber ||
      o?.balancePayment?.payment?.inflow?.beneficiaryAccountNumber ||
      o?.shipmentPayment?.payment?.inflow?.beneficiaryAccountNumber ||
      o?.vasVirtualAccount?.vNUBAN ||
      o?.vasVirtualAccount?.vaNuban ||
      "";
    return String(raw).replace(/\D/g, "").trim();
  };

  const getShipmentVaNubanFromOrder = (o) => {
    const raw =
      o?.shipmentPayment?.payment?.paidIntoAccount ||
      o?.shipmentPayment?.paidIntoAccount ||
      o?.shipmentPayment?.payment?.inflow?.beneficiaryAccountNumber ||
      o?.shipmentPayment?.inflow?.beneficiaryAccountNumber ||
      o?.shipmentPayment?.payment?.vaNuban ||
      o?.shipmentPayment?.payment?.vaNUBAN ||
      o?.shipmentPayment?.payment?.vNuban ||
      o?.shipmentPayment?.payment?.vNUBAN ||
      o?.shipmentPayment?.vaNuban ||
      o?.shipmentPayment?.vaNUBAN ||
      o?.shipmentPayment?.vNuban ||
      o?.shipmentPayment?.vNUBAN ||
      "";
    return String(raw).replace(/\D/g, "").trim();
  };

  const maskNuban = (nuban) => {
    const x = String(nuban || "").replace(/\D/g, "");
    if (!x) return "—";
    if (x.length < 6) return x;
    return `${x.slice(0, 3)}****${x.slice(-4)}`;
  };

  const getShipmentFee = (order) => {
    const stored = Number(order?.shipmentPayment?.amount || 0);
    if (stored > 0) return stored;

    if (!shipmentItems || shipmentItems.length === 0) {
      return Number(order?.shipmentFee || 0);
    }

    const match = shipmentItems.find((item) =>
      order?.cart?.some(
        (c) =>
          c?.name?.toLowerCase() === item?.name?.toLowerCase() ||
          c?.title?.toLowerCase() === item?.name?.toLowerCase()
      )
    );

    return Number(match?.shipmentFee || order?.shipmentFee || 0);
  };

  const getShipmentPaidInfo = (order) => {
    const sp = order?.shipmentPayment || {};
    const state = String(sp?.state || sp?.payment?.state || "").trim().toLowerCase() || "";

    const expected =
      toNum(sp?.payment?.amount) ||
      toNum(sp?.payableTotal) ||
      toNum(sp?.amount) ||
      toNum(order?.shipmentFee) ||
      toNum(getShipmentFee(order));

    const inflowAmtRaw =
      sp?.payment?.inflow?.paidTotal ??
      sp?.payment?.inflow?.amountNormalized ??
      sp?.payment?.inflow?.amount;

    const inflowAmt = toNum(inflowAmtRaw);

    const paidTotal =
      toNum(sp?.amountPaid) ||
      toNum(sp?.payment?.amountPaid) ||
      inflowAmt ||
      0;

    const calculatedOutstanding = Math.max(0, expected - paidTotal);

    const isPaid = state === "paid" || (expected > 0 && paidTotal >= expected);
    const isPartial =
      !isPaid && (state === "partial" || (expected > 0 && paidTotal > 0 && paidTotal < expected));

    const outstanding =
      isPaid
        ? 0
        : toNum(sp?.outstanding) ||
          toNum(sp?.payment?.outstanding) ||
          calculatedOutstanding;

    const receivedInto =
      String(
        sp?.payment?.paidIntoAccount ||
          sp?.paidIntoAccount ||
          sp?.payment?.inflow?.beneficiaryAccountNumber ||
          sp?.inflow?.beneficiaryAccountNumber ||
          ""
      )
        .replace(/\D/g, "")
        .trim() || getShipmentVaNubanFromOrder(order);

    return {
      state: isPaid ? "paid" : isPartial ? "partial" : state || (sp?.enabled ? "enabled" : "not enabled"),
      enabled: !!sp?.enabled,
      isPaid,
      isPartial,
      expected,
      paidTotal,
      outstanding,
      paidAt: sp?.paidAt || sp?.payment?.paidAt || null,
      receivedInto,
    };
  };

  const getBalancePaidInfo = (order) => {
    const bp = order?.balancePayment || {};
    const stateRaw = String(bp?.state || bp?.payment?.state || "").trim().toLowerCase() || "";

    const expected =
      toNum(bp?.payment?.amount) ||
      toNum(bp?.payableTotal) ||
      toNum(bp?.amount) ||
      0;

    const inflowAmtRaw =
      bp?.payment?.inflow?.paidTotal ??
      bp?.payment?.inflow?.amountNormalized ??
      bp?.payment?.inflow?.amount ??
      bp?.payment?.inflow?.amountPaid ??
      bp?.payment?.inflow?.["amount paid"];

    const inflowAmt = toNum(inflowAmtRaw);

    const paidTotal =
      toNum(bp?.amountPaid) ||
      toNum(bp?.payment?.amountPaid) ||
      inflowAmt ||
      0;

    const calculatedOutstanding = Math.max(0, expected - paidTotal);

    const isPaid = stateRaw === "paid" || (expected > 0 && paidTotal >= expected);
    const isPartial =
      !isPaid &&
      (stateRaw === "partial" || (expected > 0 && paidTotal > 0 && paidTotal < expected));

    const outstanding =
      isPaid
        ? 0
        : toNum(bp?.outstanding) ||
          toNum(bp?.payment?.outstanding) ||
          calculatedOutstanding;

    return {
      state: isPaid ? "paid" : isPartial ? "partial" : stateRaw || (bp?.enabled ? "enabled" : "not enabled"),
      enabled: !!bp?.enabled,
      isPaid,
      isPartial,
      expected,
      paidTotal,
      outstanding,
      paidAt: bp?.paidAt || bp?.payment?.paidAt || null,
    };
  };

  const getOrderPaidInfo = (order) => {
    const inflow = order?.payment?.inflow || {};
    const rawPayload = order?.payment?.rawPayload || order?.rawPayload || {};

    const payableAmount =
      toNum(order?.payableTotal) ||
      toNum(order?.payment?.payableTotal) ||
      toNum(rawPayload?.payableTotal) ||
      toNum(order?.payment?.amount) ||
      0;

    const mainPaidAmount =
      toNum(order?.payment?.amountPaid) ||
      toNum(inflow?.paidTotal) ||
      toNum(inflow?.amountNormalized) ||
      toNum(inflow?.amount) ||
      toNum(order?.inflow?.amountNormalized) ||
      toNum(order?.inflow?.amount) ||
      0;

    const balanceInfo = getBalancePaidInfo(order);
    const balanceExpected = Number(balanceInfo.expected || 0);
    const balancePaid = Number(balanceInfo.paidTotal || 0);

    const balanceCleared =
      balanceInfo.isPaid || (balanceExpected > 0 && balancePaid >= balanceExpected);

    const paidAmount = balanceCleared
      ? payableAmount
      : Math.min(payableAmount, mainPaidAmount + balancePaid);

    const outstanding = balanceCleared ? 0 : Math.max(0, payableAmount - paidAmount);

    const statusRaw = String(order?.payment?.status || order?.orderStatus || "").trim();
    const status = statusRaw.toLowerCase();

    const isMarkedPaid =
      status === "paid" ||
      status === "success" ||
      !!order?.payment?.paidAt ||
      String(order?.orderStatus || "").toLowerCase() === "paid" ||
      balanceCleared ||
      (payableAmount > 0 && paidAmount >= payableAmount);

    const isUnderpaid = payableAmount > 0 && paidAmount > 0 && paidAmount < payableAmount;

    return {
      payableAmount: payableAmount || 0,
      paidAmount: paidAmount || 0,
      balance: outstanding || 0,
      isMarkedPaid,
      isUnderpaid,
    };
  };

  const getVatAmount = (order) => {
    const vatStored = toNum(order?.vat?.amount ?? order?.payment?.rawPayload?.vatAmount ?? 0);
    if (Number.isFinite(vatStored) && vatStored > 0) return vatStored;
    return 0;
  };

  const getVatRate = (order) => {
    const r =
      toNum(order?.vat?.rate) ||
      toNum(order?.payment?.rawPayload?.vatRate) ||
      toNum(order?.payment?.rawPayload?.vat_percent) ||
      0;

    if (!Number.isFinite(r) || r <= 0) return 0;
    return r > 1 ? r / 100 : r;
  };

  const getBaseBeforeVat = (order) => {
    const grandTotalBase = toNum(order?.grandTotal ?? 0);
    if (Number.isFinite(grandTotalBase) && grandTotalBase > 0) return grandTotalBase;

    const items = toNum(order?.totalAmount ?? 0) || 0;
    const delivery = toNum(order?.shipmentFee ?? 0) || toNum(getShipmentFee(order) || 0) || 0;
    return items + delivery;
  };

  const getPayableTotal = (order) => {
    const stored = toNum(order?.payableTotal ?? order?.payment?.amount ?? 0);
    if (Number.isFinite(stored) && stored > 0) return stored;

    const base = getBaseBeforeVat(order);
    const vat = getVatAmount(order);
    return base + vat;
  };

  const TRACKING_LABEL = (o) => String(o?.tracking?.stage || o?.trackingStage || "").trim() || "—";

  const docRefFromPath = (path) => {
    const p = String(path || "").trim();
    const parts = p.split("/").filter(Boolean);
    if (parts.length < 2 || parts.length % 2 !== 0) return null;

    try {
      return doc(db, ...parts);
    } catch (e) {
      console.warn("docRefFromPath failed:", e?.message || e);
      return null;
    }
  };

  const getOrderPathFromOrder = (order) => {
    const orderId = String(order?.id || "").trim();
    const userId = String(order?.userId || "").trim();

    return (
      String(order?.orderPath || "").trim() ||
      (userId && orderId ? `charex/main/users/${userId}/orders/${orderId}` : "")
    );
  };

  const fetchFreshOrderDoc = async (order) => {
    const orderId = String(order?.id || "").trim();
    const orderPath = getOrderPathFromOrder(order);

    if (!orderPath) return { orderPath: "", fresh: null };

    try {
      const orderDocRef = docRefFromPath(orderPath);
      if (!orderDocRef) return { orderPath, fresh: null };

      const snap = await getDoc(orderDocRef);
      const fresh = snap.exists() ? { id: orderId, ...snap.data() } : null;
      return { orderPath, fresh };
    } catch (e) {
      console.warn("fetchFreshOrderDoc failed:", e?.message || e);
      return { orderPath, fresh: null };
    }
  };

  const formatYyyyMmDd = (d) => {
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  const normalizePaymentState = (value) => {
    return String(value || "").trim().toLowerCase();
  };

  const isPaidLikeState = (value) => {
    const s = normalizePaymentState(value);
    return ["paid", "success", "successful", "succeeded", "completed", "complete"].includes(s);
  };

  const isPendingLikeState = (value) => {
    const s = normalizePaymentState(value);
    return ["pending", "unpaid", "enabled", "processing"].includes(s);
  };

  const getRepairModeLabel = (mode) => {
    if (mode === "balance") return "Balance Payment";
    if (mode === "shipment") return "Shipment Payment";
    return "Order Payment";
  };

  const getPaymentSectionState = (order, mode) => {
    if (mode === "balance") {
      return normalizePaymentState(order?.balancePayment?.state || order?.balancePayment?.payment?.state);
    }

    if (mode === "shipment") {
      return normalizePaymentState(order?.shipmentPayment?.state || order?.shipmentPayment?.payment?.state);
    }

    return normalizePaymentState(
      order?.payment?.status ||
        order?.payment?.state ||
        order?.orderStatus ||
        order?.status
    );
  };

  const getPaymentSectionExpected = (order, mode) => {
    if (mode === "balance") return Number(getBalancePaidInfo(order).expected || 0);
    if (mode === "shipment") return Number(getShipmentPaidInfo(order).expected || 0);
    return Number(getOrderPaidInfo(order).payableAmount || 0);
  };

  const getPaymentSectionPaidTotal = (order, mode) => {
    if (mode === "balance") return Number(getBalancePaidInfo(order).paidTotal || 0);
    if (mode === "shipment") return Number(getShipmentPaidInfo(order).paidTotal || 0);
    return Number(getOrderPaidInfo(order).paidAmount || 0);
  };

  const getPaymentSectionOutstanding = (order, mode) => {
    if (mode === "balance") return Number(getBalancePaidInfo(order).outstanding || 0);
    if (mode === "shipment") return Number(getShipmentPaidInfo(order).outstanding || 0);
    return Number(getOrderPaidInfo(order).balance || 0);
  };

  const getPaymentSectionPaidAt = (order, mode) => {
    if (mode === "balance") {
      return order?.balancePayment?.paidAt || order?.balancePayment?.payment?.paidAt || null;
    }

    if (mode === "shipment") {
      return order?.shipmentPayment?.paidAt || order?.shipmentPayment?.payment?.paidAt || null;
    }

    return order?.payment?.paidAt || order?.paidAt || null;
  };

  const getPaymentSectionReference = (order, mode) => {
    if (mode === "balance") {
      return (
        order?.balancePayment?.payment?.reference ||
        order?.balancePayment?.reference ||
        order?.balancePayment?.payment?.paymentRef ||
        ""
      );
    }

    if (mode === "shipment") {
      return (
        order?.shipmentPayment?.payment?.reference ||
        order?.shipmentPayment?.reference ||
        order?.shipmentPayment?.payment?.paymentRef ||
        ""
      );
    }

    return order?.payment?.reference || order?.payment?.paymentRef || order?.id || "";
  };

  const getPaymentSectionVaNuban = (order, mode) => {
    if (mode === "balance") {
      const raw =
        order?.balancePayment?.payment?.paidIntoAccount ||
        order?.balancePayment?.paidIntoAccount ||
        order?.balancePayment?.payment?.inflow?.beneficiaryAccountNumber ||
        order?.balancePayment?.inflow?.beneficiaryAccountNumber ||
        order?.balancePayment?.payment?.vaNuban ||
        order?.balancePayment?.payment?.vaNUBAN ||
        order?.balancePayment?.payment?.vNuban ||
        order?.balancePayment?.payment?.vNUBAN ||
        "";

      return String(raw).replace(/\D/g, "").trim();
    }

    if (mode === "shipment") {
      return getShipmentVaNubanFromOrder(order);
    }

    return getVaNubanFromOrder(order);
  };

  const getPaymentSectionInflow = (order, mode) => {
    if (mode === "balance") {
      return order?.balancePayment?.payment?.inflow || order?.balancePayment?.inflow || null;
    }

    if (mode === "shipment") {
      return order?.shipmentPayment?.payment?.inflow || order?.shipmentPayment?.inflow || null;
    }

    return order?.payment?.inflow || order?.inflow || null;
  };

  const paymentSectionHasUsefulInflow = (order, mode) => {
    const inflow = getPaymentSectionInflow(order, mode);
    if (!inflow || typeof inflow !== "object") return false;

    const amount =
      toNum(inflow?.paidTotal) ||
      toNum(inflow?.amountNormalized) ||
      toNum(inflow?.amount) ||
      toNum(inflow?.amountPaid) ||
      toNum(inflow?.["amount paid"]);

    const account = String(
      inflow?.beneficiaryAccountNumber ||
        inflow?.creditAccount ||
        inflow?.accountNumber ||
        inflow?.destinationAccount ||
        ""
    )
      .replace(/\D/g, "")
      .trim();

    return amount > 0 || !!account || !!inflow?.restoredByAdmin || !!inflow?.source;
  };

  const getPaymentAuditForMode = (order, mode) => {
    const audit = order?.paymentAudit;
    if (!audit || typeof audit !== "object") return null;

    const modeAudit = audit?.[mode];
    if (modeAudit && typeof modeAudit === "object") return modeAudit;

    // Fallback for older audit shape where only the latest mode was stored at root.
    const lastKnownMode = String(audit?.lastKnownMode || audit?.lastUpdatedMode || "")
      .trim()
      .toLowerCase();

    if (lastKnownMode && lastKnownMode !== mode) return null;

    if (
      audit?.lastKnownState ||
      audit?.lastKnownStatus ||
      audit?.lastKnownInflow ||
      audit?.lastKnownPaidTotal ||
      audit?.lastKnownAmountPaid
    ) {
      return audit;
    }

    return null;
  };

  const getAuditAmount = (audit, currentExpected = 0) => {
    if (!audit || typeof audit !== "object") return 0;

    return (
      toNum(audit?.paidTotal) ||
      toNum(audit?.amountPaid) ||
      toNum(audit?.amount) ||
      toNum(audit?.["amount paid"]) ||
      toNum(audit?.lastKnownPaidTotal) ||
      toNum(audit?.lastKnownAmountPaid) ||
      toNum(audit?.lastKnownInflow?.paidTotal) ||
      toNum(audit?.lastKnownInflow?.amountPaid) ||
      toNum(audit?.lastKnownInflow?.amount) ||
      toNum(audit?.lastKnownInflow?.["amount paid"]) ||
      toNum(audit?.inflow?.paidTotal) ||
      toNum(audit?.inflow?.amountPaid) ||
      toNum(audit?.inflow?.amount) ||
      toNum(audit?.inflow?.["amount paid"]) ||
      toNum(currentExpected) ||
      0
    );
  };

  const auditHasUsefulInflow = (audit) => {
    if (!audit || typeof audit !== "object") return false;

    const inflow = audit?.lastKnownInflow || audit?.inflow || null;
    const amount = getAuditAmount(audit);

    const account = String(
      audit?.vNUBAN ||
        audit?.vaNuban ||
        audit?.paidIntoAccount ||
        inflow?.beneficiaryAccountNumber ||
        inflow?.creditAccount ||
        inflow?.accountNumber ||
        inflow?.destinationAccount ||
        ""
    )
      .replace(/\D/g, "")
      .trim();

    return amount > 0 || !!account || !!inflow || !!audit?.paymentReference || !!audit?.customerReference;
  };

  const auditHasPaidOrPartialHistory = (audit) => {
    if (!audit || typeof audit !== "object") return false;

    const state = normalizePaymentState(
      audit?.lastKnownState ||
        audit?.state ||
        audit?.lastKnownStatus ||
        audit?.status ||
        audit?.paymentStatus
    );

    const amount = getAuditAmount(audit);
    const expected =
      toNum(audit?.expected) ||
      toNum(audit?.lastKnownExpected) ||
      toNum(audit?.lastKnownInflow?.expected) ||
      toNum(audit?.inflow?.expected) ||
      0;

    return (
      isPaidLikeState(state) ||
      state === "partial" ||
      amount > 0 ||
      (expected > 0 && amount >= expected)
    );
  };

  const makeTrackedMetaFromAudit = (order, mode, audit, current = null) => {
    if (!audit || typeof audit !== "object") return null;
    if (!auditHasPaidOrPartialHistory(audit) || !auditHasUsefulInflow(audit)) return null;

    const orderId = String(order?.id || current?.orderId || "").trim();
    if (!orderId) return null;

    const expected =
      toNum(audit?.expected) ||
      toNum(audit?.lastKnownExpected) ||
      toNum(audit?.lastKnownInflow?.expected) ||
      toNum(audit?.inflow?.expected) ||
      Number(current?.expected || 0) ||
      0;

    const paidTotal = getAuditAmount(audit, expected);
    const inflow = audit?.lastKnownInflow || audit?.inflow || null;

    return {
      key: `${orderId}_${mode}`,
      orderId,
      mode,
      source: "paymentAudit",
      state: normalizePaymentState(audit?.lastKnownState || audit?.state || audit?.lastKnownStatus || "paid"),
      expected,
      paidTotal,
      paidAt: audit?.paidAt || audit?.verifiedAtIso || audit?.lastVerifiedAtIso || null,
      reference:
        audit?.reference ||
        audit?.paymentReference ||
        audit?.lastKnownPaymentReference ||
        inflow?.paymentReference ||
        current?.reference ||
        "",
      customerReference:
        audit?.customerReference ||
        audit?.lastKnownCustomerReference ||
        inflow?.customerReference ||
        null,
      vaNuban: String(
        audit?.vNUBAN ||
          audit?.vaNuban ||
          inflow?.beneficiaryAccountNumber ||
          current?.vaNuban ||
          ""
      )
        .replace(/\D/g, "")
        .trim(),
      orderPath: getOrderPathFromOrder(order),
      userId: String(order?.userId || current?.userId || ""),
      customerName: current?.customerName || order?.customer?.name || order?.userName || order?.userEmail || "Guest",
      itemsText: current?.itemsText || (Array.isArray(order?.cart) ? order.cart.map((item) => getItemDisplayName(item)).join(", ") : ""),
      createdAt: current?.createdAt || order?.createdAt || null,
      updatedAt: current?.updatedAt || order?.updatedAt || null,
      inflow,
      trackedAt: audit?.verifiedAtIso || audit?.lastVerifiedAtIso || new Date().toISOString(),
      lastSeenPaidAt: audit?.verifiedAtIso || audit?.lastVerifiedAtIso || new Date().toISOString(),
    };
  };

  const getPaymentSectionSnapshot = (order, mode) => {
    const orderId = String(order?.id || "").trim();
    if (!orderId) return null;

    const state = getPaymentSectionState(order, mode);
    const expected = getPaymentSectionExpected(order, mode);
    const paidTotal = getPaymentSectionPaidTotal(order, mode);
    const outstanding = getPaymentSectionOutstanding(order, mode);
    const paidAt = getPaymentSectionPaidAt(order, mode);
    const reference = String(getPaymentSectionReference(order, mode) || "").trim();
    const vaNuban = getPaymentSectionVaNuban(order, mode);
    const inflow = getPaymentSectionInflow(order, mode);
    const hasInflow = paymentSectionHasUsefulInflow(order, mode);

    const paidByState = isPaidLikeState(state);
    const partialByState = normalizePaymentState(state) === "partial";
    const paidByAmount = expected > 0 && paidTotal >= expected;
    const partialByAmount = expected > 0 && paidTotal > 0 && paidTotal < expected;

    const isPaidWithInflow =
      hasInflow &&
      (paidByState || partialByState || paidByAmount || partialByAmount || !!paidAt);

    return {
      key: `${orderId}_${mode}`,
      orderId,
      mode,
      label: getRepairModeLabel(mode),
      state,
      expected,
      paidTotal,
      outstanding,
      paidAt,
      reference,
      vaNuban,
      hasInflow,
      isPaidWithInflow,
      inflow,
      orderPath: getOrderPathFromOrder(order),
      userId: String(order?.userId || ""),
      customerName: order?.customer?.name || order?.userName || order?.userEmail || "Guest",
      createdAt: order?.createdAt || null,
      updatedAt: order?.updatedAt || null,
      itemsText: Array.isArray(order?.cart)
        ? order.cart.map((item) => getItemDisplayName(item)).join(", ")
        : "",
    };
  };

  const buildPaymentRepairIssueFromTrackedSnapshot = (order, mode, trackedMeta) => {
    if (!trackedMeta) return null;

    const current = getPaymentSectionSnapshot(order, mode);
    if (!current) return null;

    const stateIsPendingNow = isPendingLikeState(current.state);
    const missingInflowNow = !current.hasInflow;

    // ✅ Tracker alarm rule:
    // Do NOT enter ordinary pending orders into the queue.
    // Do NOT rely on current row or browser/runtime memory before reporting a flip.
    // First require Firestore paymentAudit to prove this section previously had
    // paid/partial payment information. Then report either the existing status
    // flip condition OR the newly required missing-inflow condition.
    if (trackedMeta?.source !== "paymentAudit") return null;
    if (!stateIsPendingNow && !missingInflowNow) return null;

    const restoreAmount =
      Number(trackedMeta.paidTotal || 0) ||
      Number(trackedMeta.expected || 0) ||
      Number(current.paidTotal || 0) ||
      Number(current.expected || 0) ||
      0;

    if (!restoreAmount || restoreAmount <= 0) return null;

    const sectionLabel = getRepairModeLabel(mode);
    const auditSource = trackedMeta?.source === "paymentAudit";
    const reason =
      stateIsPendingNow && missingInflowNow
        ? auditSource
          ? `${sectionLabel} has Firestore paymentAudit showing paid/partial with inflow, but the current row is pending and the inflow map is missing.`
          : `${sectionLabel} was previously seen as paid/partial with inflow, but is now pending and the inflow map is missing.`
        : stateIsPendingNow
        ? auditSource
          ? `${sectionLabel} has Firestore paymentAudit showing paid/partial with inflow, but the current state has changed back to pending.`
          : `${sectionLabel} was previously seen as paid/partial with inflow, but the current state has changed back to pending.`
        : auditSource
        ? `${sectionLabel} has Firestore paymentAudit showing paid/partial with inflow, but the current inflow map is missing.`
        : `${sectionLabel} was previously seen as paid/partial with inflow, but the current inflow map is missing.`;

    return {
      key: current.key,
      orderId: current.orderId,
      mode,
      label: sectionLabel,
      state: current.state,
      expected: Number(trackedMeta.expected || current.expected || restoreAmount || 0),
      paidTotal: Number(trackedMeta.paidTotal || restoreAmount || 0),
      outstanding: Math.max(0, Number(trackedMeta.expected || current.expected || restoreAmount || 0) - restoreAmount),
      restoreAmount,
      paidAt: trackedMeta.paidAt || null,
      reference: current.reference || trackedMeta.reference || "",
      vaNuban: current.vaNuban || trackedMeta.vaNuban || "",
      reason,
      detectedAt: paymentFlipLogByKey?.[current.key]?.detectedAt || new Date().toISOString(),
      runtimeDetected: false,
      auditDetected: trackedMeta?.source === "paymentAudit",
      trackedSource: "paymentAudit",
      stateChangedToPending: stateIsPendingNow,
      inflowMissingAfterAudit: missingInflowNow,
      trackedAt: trackedMeta.trackedAt,
      trackedState: trackedMeta.state || "",
      trackedInflow: trackedMeta.inflow || null,
      disappearedFromPaidList: !!trackedMeta.disappearedFromPaidList,
      orderPath: trackedMeta.orderPath || getOrderPathFromOrder(order),
    };
  };

  useEffect(() => {
    if (!Array.isArray(orders)) return;

    if (!isAdmin) return;

    const nowIso = new Date().toISOString();
    const detected = {};

    orders.forEach((order) => {
      const orderId = String(order?.id || "").trim();
      if (!orderId) return;

      PAYMENT_REPAIR_MODES.forEach((mode) => {
        const snapshot = getPaymentSectionSnapshot(order, mode);
        if (!snapshot) return;

        const key = snapshot.key;
        if (resolvedRepairKeys[key]) return;

        // ✅ Firestore paymentAudit is the ONLY source of truth for alarms.
        // Do not use runtime snapshots to decide that a row flipped
        // or that an inflow disappeared.
        const auditMeta = makeTrackedMetaFromAudit(
          order,
          mode,
          getPaymentAuditForMode(order, mode),
          snapshot
        );

        if (!auditMeta) return;

        const issue = buildPaymentRepairIssueFromTrackedSnapshot(order, mode, auditMeta);
        if (!issue) return;

        const stateChangedToPending = !!issue.stateChangedToPending;
        const inflowMissingAfterAudit = !!issue.inflowMissingAfterAudit;
        const sectionLabel = getRepairModeLabel(mode);

        detected[key] = {
          key,
          orderId,
          mode,
          fromState: auditMeta.state || "paid",
          toState: snapshot.state || "pending",
          detectedAt: nowIso,
          source: "paymentAudit",
          stateChangedToPending,
          inflowMissingAfterAudit,
          reason:
            issue.reason ||
            (stateChangedToPending && inflowMissingAfterAudit
              ? `${sectionLabel} has paymentAudit showing paid/partial with inflow, but current row is pending with inflow missing.`
              : stateChangedToPending
              ? `${sectionLabel} has paymentAudit showing paid/partial with inflow, but current state changed back to pending.`
              : `${sectionLabel} has paymentAudit showing paid/partial with inflow, but current inflow is missing.`),
        };
      });
    });

    const count = Object.keys(detected).length;

    if (count > 0) {
      setPaymentFlipLogByKey((prev) => ({ ...prev, ...detected }));
      toast.warn(`${count} changed paid row(s) detected from paymentAudit. Open Changed Rows to correct.`);
    }
  }, [orders, isAdmin, PAYMENT_REPAIR_MODES, resolvedRepairKeys]);

  const makeRestoredInflowPayload = ({
    amount,
    expected,
    outstanding,
    paidIntoAccount,
    reference,
    mode,
    previousInflow = null,
  }) => {
    const n = Number(amount || 0);
    const exp = Number(expected || previousInflow?.expected || n || 0);
    const out = Number(outstanding || 0);

    return {
      ...(previousInflow && typeof previousInflow === "object" ? previousInflow : {}),
      successfulCount: Number(previousInflow?.successfulCount || 1),
      expected: exp,
      paidTotal: n,
      amountNormalized: n,
      amount: n,
      amountPaid: n,
      "amount paid": n,
      outstanding: out,
      beneficiaryAccountNumber: String(paidIntoAccount || "").replace(/\D/g, "").trim(),
      paymentReference: previousInflow?.paymentReference || reference || null,
      customerReference: previousInflow?.customerReference || null,
      reference: reference || previousInflow?.reference || null,
      source: "admin_payment_repair_queue",
      mode,
      restoredByAdmin: true,
      updatedAt: new Date().toISOString(),
      restoredAt: serverTimestamp(),
      restoredBy: currentUser?.uid || null,
      restoredByEmail: currentUser?.email || null,
    };
  };

  const applyLocalRepairToOrder = (order, issue) => {
    if (!order || !issue) return order;

    const paidIntoAccount = issue.vaNuban || getPaymentSectionVaNuban(order, issue.mode);
    const restoredAt = new Date().toISOString();
    const restoreAmount = Number(issue.restoreAmount || issue.paidTotal || issue.expected || 0);
    const expected = Number(issue.expected || restoreAmount || 0);
    const restoredOutstanding = Math.max(0, expected - restoreAmount);
    const isFullyPaid = expected > 0 && restoreAmount >= expected;
    const restoredState = isFullyPaid ? "paid" : restoreAmount > 0 ? "partial" : "pending";
    const restoredStatus = isFullyPaid ? "Paid" : restoredState;
    const restoredOrderStatus = isFullyPaid ? "Paid" : "Pending";
    const previousInflow = issue.trackedInflow || null;

    const localInflow = {
      ...(previousInflow && typeof previousInflow === "object" ? previousInflow : {}),
      successfulCount: Number(previousInflow?.successfulCount || 1),
      expected,
      paidTotal: restoreAmount,
      amountNormalized: restoreAmount,
      amount: restoreAmount,
      amountPaid: restoreAmount,
      "amount paid": restoreAmount,
      outstanding: restoredOutstanding,
      beneficiaryAccountNumber: paidIntoAccount || "",
      paymentReference: previousInflow?.paymentReference || issue.reference || null,
      customerReference: previousInflow?.customerReference || null,
      reference: issue.reference || previousInflow?.reference || null,
      source: "admin_payment_repair_queue",
      mode: issue.mode,
      restoredByAdmin: true,
      updatedAt: restoredAt,
      restoredAt,
      restoredBy: currentUser?.uid || null,
      restoredByEmail: currentUser?.email || null,
    };

    if (issue.mode === "balance") {
      return {
        ...order,
        updatedAt: restoredAt,
        balancePayment: {
          ...(order.balancePayment || {}),
          enabled: true,
          state: restoredState,
          paidAt: isFullyPaid ? restoredAt : order.balancePayment?.paidAt || null,
          amountPaid: restoreAmount,
          outstanding: restoredOutstanding,
          payment: {
            ...(order.balancePayment?.payment || {}),
            state: restoredState,
            paidAt: isFullyPaid ? restoredAt : order.balancePayment?.payment?.paidAt || null,
            paidIntoAccount: paidIntoAccount || "",
            inflow: {
              ...(order.balancePayment?.payment?.inflow || {}),
              ...localInflow,
            },
          },
        },
      };
    }

    if (issue.mode === "shipment") {
      return {
        ...order,
        updatedAt: restoredAt,
        shipmentPayment: {
          ...(order.shipmentPayment || {}),
          enabled: true,
          state: restoredState,
          paidAt: isFullyPaid ? restoredAt : order.shipmentPayment?.paidAt || null,
          amountPaid: restoreAmount,
          outstanding: restoredOutstanding,
          payment: {
            ...(order.shipmentPayment?.payment || {}),
            state: restoredState,
            paidAt: isFullyPaid ? restoredAt : order.shipmentPayment?.payment?.paidAt || null,
            paidIntoAccount: paidIntoAccount || "",
            inflow: {
              ...(order.shipmentPayment?.payment?.inflow || {}),
              ...localInflow,
            },
          },
        },
      };
    }

    return {
      ...order,
      updatedAt: restoredAt,
      orderStatus: restoredOrderStatus,
      payment: {
        ...(order.payment || {}),
        status: restoredStatus,
        state: restoredState,
        paidAt: isFullyPaid ? restoredAt : order.payment?.paidAt || null,
        amountPaid: restoreAmount,
        outstanding: restoredOutstanding,
        paidIntoAccount: paidIntoAccount || "",
        inflow: {
          ...(order.payment?.inflow || {}),
          ...localInflow,
        },
      },
    };
  };

  const restoreChangedPaymentRow = async (row) => {
    if (!currentUser) return toast.error("Please sign in");
    if (!isAdmin) return toast.error("Only admin can correct changed payment rows");

    const order = row?.order || {};
    const originalIssue = row?.issue || null;
    const orderId = String(order?.id || originalIssue?.orderId || "").trim();
    const mode = String(originalIssue?.mode || "").trim();

    if (!orderId || !mode) return toast.error("Invalid repair row");

    const repairKey = `${orderId}_${mode}`;

    try {
      setRepairById((p) => ({ ...p, [repairKey]: true }));

      const { orderPath: guessedPath, fresh } = await fetchFreshOrderDoc(order);
      const o = fresh || order || {};

      const effectiveOrderPath =
        String(o?.orderPath || "").trim() ||
        guessedPath ||
        (o?.userId ? `charex/main/users/${o.userId}/orders/${orderId}` : "");

      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const currentSnapshot = getPaymentSectionSnapshot(o, mode);
      const trackedMeta = makeTrackedMetaFromAudit(o, mode, getPaymentAuditForMode(o, mode), currentSnapshot);
      const issue = buildPaymentRepairIssueFromTrackedSnapshot(o, mode, trackedMeta) || originalIssue;

      if (!issue || !trackedMeta) {
        toast.info("This row has no Firestore paymentAudit proof, so it will not be auto-corrected.");
        setResolvedRepairKeys((p) => ({ ...p, [repairKey]: true }));
        return;
      }

      const expected = Number(issue.expected || getPaymentSectionExpected(o, mode) || 0);
      const restoreAmount = Number(issue.restoreAmount || issue.paidTotal || expected || 0);
      const restoredOutstanding = Math.max(0, expected - restoreAmount);
      const isFullyPaid = expected > 0 && restoreAmount >= expected;
      const restoredState = isFullyPaid ? "paid" : restoreAmount > 0 ? "partial" : "pending";
      const restoredStatus = isFullyPaid ? "Paid" : restoredState;
      const restoredOrderStatus = isFullyPaid ? "Paid" : "Pending";
      const previousInflow = issue.trackedInflow || trackedMeta?.inflow || null;

      if (!restoreAmount || restoreAmount <= 0) {
        toast.error("No amount found to restore");
        return;
      }

      const paidIntoAccount =
        String(issue.vaNuban || getPaymentSectionVaNuban(o, mode) || getVaNubanFromOrder(o) || "")
          .replace(/\D/g, "")
          .trim() || "";

      const reference = issue.reference || getPaymentSectionReference(o, mode) || orderId;

      const inflowPayload = makeRestoredInflowPayload({
        amount: restoreAmount,
        expected,
        outstanding: restoredOutstanding,
        paidIntoAccount,
        reference,
        mode,
        previousInflow,
      });

      const repairLog = {
        section: mode,
        sectionLabel: getRepairModeLabel(mode),
        fromState: issue.state || "pending",
        toState: restoredState,
        amount: restoreAmount,
        expected,
        outstanding: restoredOutstanding,
        paidIntoAccount: paidIntoAccount || null,
        reference: reference || null,
        reason: issue.reason || "Admin restored missing inflow after a tracked paid-to-pending flip.",
        trackedAt: issue.trackedAt || trackedMeta.trackedAt || null,
        at: new Date().toISOString(),
        by: currentUser?.uid || null,
        byEmail: currentUser?.email || null,
      };

      if (mode === "balance") {
        await setDoc(
          orderDocRef,
          {
            updatedAt: serverTimestamp(),
            paymentRepair: {
              hasOpenIssue: false,
              lastResolvedAt: serverTimestamp(),
              lastResolvedBy: currentUser?.uid || null,
              lastResolvedByEmail: currentUser?.email || null,
              lastResolvedSection: "balance",
            },
            paymentRepairLog: arrayUnion(repairLog),
            balancePayment: {
              enabled: true,
              state: restoredState,
              paidAt: isFullyPaid ? serverTimestamp() : o?.balancePayment?.paidAt || null,
              amountPaid: restoreAmount,
              outstanding: restoredOutstanding,
              repairedAt: serverTimestamp(),
              repairedBy: currentUser?.uid || null,
              repairedByEmail: currentUser?.email || null,
              payment: {
                state: restoredState,
                paidAt: isFullyPaid ? serverTimestamp() : o?.balancePayment?.payment?.paidAt || null,
                paidIntoAccount: paidIntoAccount || null,
                inflow: inflowPayload,
              },
            },
          },
          { merge: true }
        );
      } else if (mode === "shipment") {
        await setDoc(
          orderDocRef,
          {
            updatedAt: serverTimestamp(),
            paymentRepair: {
              hasOpenIssue: false,
              lastResolvedAt: serverTimestamp(),
              lastResolvedBy: currentUser?.uid || null,
              lastResolvedByEmail: currentUser?.email || null,
              lastResolvedSection: "shipment",
            },
            paymentRepairLog: arrayUnion(repairLog),
            shipmentPayment: {
              enabled: true,
              state: restoredState,
              paidAt: isFullyPaid ? serverTimestamp() : o?.shipmentPayment?.paidAt || null,
              amountPaid: restoreAmount,
              outstanding: restoredOutstanding,
              repairedAt: serverTimestamp(),
              repairedBy: currentUser?.uid || null,
              repairedByEmail: currentUser?.email || null,
              payment: {
                state: restoredState,
                paidAt: isFullyPaid ? serverTimestamp() : o?.shipmentPayment?.payment?.paidAt || null,
                paidIntoAccount: paidIntoAccount || null,
                inflow: inflowPayload,
              },
            },
          },
          { merge: true }
        );
      } else {
        await setDoc(
          orderDocRef,
          {
            updatedAt: serverTimestamp(),
            orderStatus: restoredOrderStatus,
            paymentRepair: {
              hasOpenIssue: false,
              lastResolvedAt: serverTimestamp(),
              lastResolvedBy: currentUser?.uid || null,
              lastResolvedByEmail: currentUser?.email || null,
              lastResolvedSection: "order",
            },
            paymentRepairLog: arrayUnion(repairLog),
            payment: {
              status: restoredStatus,
              state: restoredState,
              paidAt: isFullyPaid ? serverTimestamp() : o?.payment?.paidAt || null,
              amountPaid: restoreAmount,
              outstanding: restoredOutstanding,
              paidIntoAccount: paidIntoAccount || null,
              inflow: inflowPayload,
            },
          },
          { merge: true }
        );
      }

      setResolvedRepairKeys((p) => ({ ...p, [repairKey]: true }));

      setPaymentFlipLogByKey((prev) => {
        const next = { ...prev };
        delete next[repairKey];
        return next;
      });

      setMissingRepairRowsByKey((prev) => {
        if (!prev[repairKey]) return prev;
        const next = { ...prev };
        delete next[repairKey];
        return next;
      });

      setSelectedOrder((prev) => {
        if (!prev || String(prev?.id || "") !== String(orderId)) return prev;
        return applyLocalRepairToOrder(prev, issue);
      });

      toast.success(`${getRepairModeLabel(mode)} corrected ✅`);
    } catch (e) {
      console.error("restoreChangedPaymentRow error:", e);
      toast.error(e?.message || "Unable to correct payment row");
    } finally {
      setRepairById((p) => ({ ...p, [repairKey]: false }));
    }
  };

  const ignoreChangedPaymentRow = (row) => {
    const key = String(row?.key || row?.issue?.key || "").trim();
    if (!key) return;
    setResolvedRepairKeys((p) => ({ ...p, [key]: true }));
    setMissingRepairRowsByKey((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    toast.info("Row deleted from this repair queue.");
  };

  const paymentRepairRows = useMemo(() => {
    if (!isAdmin) return [];

    const rows = [];

    (orders || []).forEach((order) => {
      const orderId = String(order?.id || "").trim();
      if (!orderId) return;

      PAYMENT_REPAIR_MODES.forEach((mode) => {
        const key = `${orderId}_${mode}`;
        if (resolvedRepairKeys[key]) return;

        const currentSnapshot = getPaymentSectionSnapshot(order, mode);
        const trackedMeta = makeTrackedMetaFromAudit(order, mode, getPaymentAuditForMode(order, mode), currentSnapshot);
        if (!trackedMeta) return;

        const issue = buildPaymentRepairIssueFromTrackedSnapshot(order, mode, trackedMeta);
        if (!issue) return;

        const customerName =
          order.customer?.name || order.userName || order.userEmail || "Guest";

        rows.push({
          key,
          order,
          issue,
          customerName,
          amount: Number(issue.restoreAmount || issue.expected || 0),
          detectedAt: issue.detectedAt,
        });
      });
    });

    Object.values(missingRepairRowsByKey || {}).forEach((row) => {
      const key = String(row?.key || row?.issue?.key || "").trim();
      if (!key || resolvedRepairKeys[key]) return;
      if (rows.some((existing) => existing.key === key)) return;
      rows.push(row);
    });

    rows.sort((a, b) => {
      const da = toDateObject(a?.order?.updatedAt || a?.order?.createdAt || a?.detectedAt);
      const db = toDateObject(b?.order?.updatedAt || b?.order?.createdAt || b?.detectedAt);
      return (db?.getTime?.() || 0) - (da?.getTime?.() || 0);
    });

    return rows;
  }, [
    orders,
    isAdmin,
    PAYMENT_REPAIR_MODES,
    paymentFlipLogByKey,
    resolvedRepairKeys,
    shipmentItems,
    missingRepairRowsByKey,
  ]);

  const changedRowsCount = paymentRepairRows.length;

  const changedOrdersCount = useMemo(() => {
    return new Set(paymentRepairRows.map((r) => r?.issue?.orderId).filter(Boolean)).size;
  }, [paymentRepairRows]);

  const changedRowsTotalAmount = useMemo(() => {
    return paymentRepairRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  }, [paymentRepairRows]);

  const confirmPaymentForOrder = async (order) => {
    const orderId = String(order?.id || "").trim();

    try {
      if (!orderId) return toast.error("Invalid order");
      if (!currentUser) return toast.error("Please sign in");

      setReconById((p) => ({ ...p, [orderId]: true }));

      const { orderPath: guessedPath, fresh } = await fetchFreshOrderDoc(order);

      const o = fresh || order || {};
      const effectiveOrderPath =
        String(o?.orderPath || "").trim() ||
        guessedPath ||
        (o?.userId ? `charex/main/users/${o.userId}/orders/${orderId}` : "");

      const bal = o?.balancePayment || {};
      const balEnabled = !!bal?.enabled;
      const balState = String(bal?.state || bal?.payment?.state || "").toLowerCase();
      const balPaid = balState === "paid";

      const ship = o?.shipmentPayment || {};
      const shipEnabled = !!ship?.enabled;
      const shipState = String(ship?.state || ship?.payment?.state || "").toLowerCase();
      const shipPaid = shipState === "paid";

      const shouldCheckBalance = balEnabled && !balPaid;
      const shouldCheckShipment = !shouldCheckBalance && shipEnabled && !shipPaid;

      let mode = "order";
      let vNUBAN = "";

      if (shouldCheckBalance) {
        mode = "balance";
        vNUBAN = String(bal?.payment?.vaNuban || bal?.payment?.vaNUBAN || "")
          .replace(/\D/g, "")
          .trim();
      } else if (shouldCheckShipment) {
        mode = "shipment";
        vNUBAN = String(ship?.payment?.vaNuban || ship?.payment?.vaNUBAN || "")
          .replace(/\D/g, "")
          .trim();
      }

      if (!vNUBAN) {
        vNUBAN = String(o?.payment?.vaNuban || o?.payment?.vNUBAN || "")
          .replace(/\D/g, "")
          .trim();
      }

      if (!vNUBAN && o?.vasVirtualAccount?.vNUBAN) {
        vNUBAN = String(o.vasVirtualAccount.vNUBAN).replace(/\D/g, "").trim();
      }

      if (!vNUBAN) {
        toast.error("No virtual account number on this order");
        return;
      }

      const today = new Date();
      const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startDate = formatYyyyMmDd(start);
      const endDate = formatYyyyMmDd(today);

      const markPaid = currentUser?.role === "admin";

      const res = await fetch("/.netlify/functions/query-inflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vNUBAN,
          vaNuban: vNUBAN,
          orderPath: effectiveOrderPath,
          firestoreNamespace: "charex/main",
          startDate,
          endDate,
          markPaid,
          userId: String(o?.userId || ""),
          orderId,
          mode,
        }),
      });

      const data = await res.json().catch(() => ({}));

      const successfulArr = Array.isArray(data?.successful)
        ? data.successful
        : Array.isArray(data?.successfulInflows)
        ? data.successfulInflows
        : [];

      if (data?.ok && successfulArr.length > 0) {
        const inflow = successfulArr[0] || null;

        if (!isAdmin) {
          toast.success("Payment found ✅");
          return;
        }

        try {
          const orderDocRef = docRefFromPath(effectiveOrderPath);
          if (orderDocRef) {
            const paidIntoAccount =
              String(
                inflow?.beneficiaryAccountNumber ||
                  inflow?.creditAccount ||
                  inflow?.accountNumber ||
                  inflow?.destinationAccount ||
                  ""
              )
                .replace(/\D/g, "")
                .trim() || vNUBAN;

            const updatedState = data?.updated?.state || "paid";
            const updatedExpected = Number(data?.updated?.expected || 0);
            const updatedPaidTotal = Number(data?.updated?.paidTotal || 0);
            const updatedOutstanding = Number(data?.updated?.outstanding || 0);

            const safeInflow = {
              ...(inflow || {}),
              expected: updatedExpected,
              paidTotal: updatedPaidTotal,
              amountNormalized: updatedPaidTotal,
              amount: updatedPaidTotal,
              amountPaid: updatedPaidTotal,
              outstanding: updatedOutstanding,
              beneficiaryAccountNumber: paidIntoAccount || vNUBAN,
              source: "query_inflow_confirm_payment",
              confirmedAt: serverTimestamp(),
            };

            if (mode === "balance") {
              await setDoc(
                orderDocRef,
                {
                  updatedAt: serverTimestamp(),
                  balancePayment: {
                    enabled: true,
                    state: updatedState,
                    paidAt: serverTimestamp(),
                    amountPaid: updatedPaidTotal,
                    outstanding: updatedOutstanding,
                    payment: {
                      state: updatedState,
                      paidAt: serverTimestamp(),
                      paidIntoAccount: paidIntoAccount || vNUBAN,
                      inflow: safeInflow,
                    },
                  },
                },
                { merge: true }
              );
            } else if (mode === "shipment") {
              await setDoc(
                orderDocRef,
                {
                  updatedAt: serverTimestamp(),
                  shipmentPayment: {
                    enabled: true,
                    state: updatedState,
                    paidAt: serverTimestamp(),
                    amountPaid: updatedPaidTotal,
                    outstanding: updatedOutstanding,
                    payment: {
                      state: updatedState,
                      paidAt: serverTimestamp(),
                      paidIntoAccount: paidIntoAccount || vNUBAN,
                      inflow: safeInflow,
                    },
                  },
                },
                { merge: true }
              );
            } else {
              await setDoc(
                orderDocRef,
                {
                  updatedAt: serverTimestamp(),
                  orderStatus: updatedState === "paid" ? "Paid" : "Pending",
                  payment: {
                    status: updatedState === "paid" ? "Paid" : "Pending",
                    state: updatedState,
                    paidAt: updatedState === "paid" ? serverTimestamp() : null,
                    amountPaid: updatedPaidTotal,
                    paidIntoAccount: paidIntoAccount || vNUBAN,
                    inflow: safeInflow,
                  },
                },
                { merge: true }
              );
            }
          }
        } catch (e) {
          console.warn("Admin client write blocked:", e?.message || e);
        }

        setSelectedOrder((prev) => {
          if (!prev || String(prev?.id || "") !== String(orderId)) return prev;

          const next = { ...prev };
          const updatedState = data?.updated?.state || "paid";
          const updatedExpected = Number(data?.updated?.expected || 0);
          const updatedPaidTotal = Number(data?.updated?.paidTotal || 0);
          const updatedOutstanding = Number(data?.updated?.outstanding || 0);

          if (mode === "balance") {
            next.balancePayment = {
              ...(next.balancePayment || {}),
              enabled: true,
              state: updatedState,
              paidAt: new Date().toISOString(),
              amountPaid: updatedPaidTotal,
              outstanding: updatedOutstanding,
              payment: {
                ...(next.balancePayment?.payment || {}),
                state: updatedState,
                paidAt: new Date().toISOString(),
                inflow: {
                  ...(next.balancePayment?.payment?.inflow || {}),
                  expected: updatedExpected,
                  paidTotal: updatedPaidTotal,
                  amountNormalized: updatedPaidTotal,
                  amount: updatedPaidTotal,
                  amountPaid: updatedPaidTotal,
                  outstanding: updatedOutstanding,
                  source: "query_inflow_confirm_payment",
                },
              },
            };
          } else if (mode === "shipment") {
            next.shipmentPayment = {
              ...(next.shipmentPayment || {}),
              enabled: true,
              state: updatedState,
              paidAt: new Date().toISOString(),
              amountPaid: updatedPaidTotal,
              outstanding: updatedOutstanding,
              payment: {
                ...(next.shipmentPayment?.payment || {}),
                state: updatedState,
                paidAt: new Date().toISOString(),
                inflow: {
                  ...(next.shipmentPayment?.payment?.inflow || {}),
                  expected: updatedExpected,
                  paidTotal: updatedPaidTotal,
                  amountNormalized: updatedPaidTotal,
                  amount: updatedPaidTotal,
                  amountPaid: updatedPaidTotal,
                  outstanding: updatedOutstanding,
                  source: "query_inflow_confirm_payment",
                },
              },
            };
          } else {
            next.orderStatus = updatedState === "paid" ? "Paid" : "Pending";
            next.payment = {
              ...(next.payment || {}),
              status: updatedState === "paid" ? "Paid" : "Pending",
              state: updatedState,
              paidAt: updatedState === "paid" ? new Date().toISOString() : null,
              amountPaid: updatedPaidTotal,
              inflow: {
                ...(next.payment?.inflow || {}),
                expected: updatedExpected,
                paidTotal: updatedPaidTotal,
                amountNormalized: updatedPaidTotal,
                amount: updatedPaidTotal,
                amountPaid: updatedPaidTotal,
                outstanding: updatedOutstanding,
                source: "query_inflow_confirm_payment",
              },
            };
          }

          return next;
        });

        toast.success("Payment confirmed ✅");
        return;
      }

      if (
        data?.ok &&
        (data?.successfulCount === 0 ||
          data?.inflowCount === 0 ||
          successfulArr.length === 0)
      ) {
        toast.info("No successful inflow yet. Try again in 1–2 minutes.");
        return;
      }

      toast.error(data?.message || "Confirm failed");
    } catch (e) {
      console.error("Confirm payment error:", e);
      toast.error(e?.message || "Confirm failed");
    } finally {
      if (orderId) setReconById((p) => ({ ...p, [orderId]: false }));
    }
  };

  const updateTrackingStage = async (order, nextStage) => {
    const orderId = String(order?.id || "").trim();
    if (!orderId) return toast.error("Invalid order");
    if (!currentUser) return toast.error("Please sign in");
    if (!isAdmin) return toast.error("Only admin can update tracking");

    const stage = String(nextStage || "").trim();
    if (!stage) return toast.error("Select a stage");
    if (!TRACKING_STAGES.includes(stage)) return toast.error("Invalid stage selected");

    try {
      setTrackById((p) => ({ ...p, [orderId]: true }));

      const { orderPath: guessedPath, fresh } = await fetchFreshOrderDoc(order);
      const o = fresh || order || {};
      const effectiveOrderPath =
        String(o?.orderPath || "").trim() ||
        guessedPath ||
        (o?.userId ? `charex/main/users/${o.userId}/orders/${orderId}` : "");

      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const feeSnapshot = getShipmentFee(o);

      await setDoc(
        orderDocRef,
        {
          updatedAt: serverTimestamp(),
          tracking: {
            stage,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser?.uid || null,
            updatedByEmail: currentUser?.email || null,
            history: arrayUnion({
              stage,
              at: new Date().toISOString(),
              by: currentUser?.uid || null,
              byEmail: currentUser?.email || null,
            }),
          },
          shipment: {
            fee: Number(feeSnapshot || 0),
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );

      toast.success(`Tracking updated ✅ (${stage})`);

      setSelectedOrder((prev) => {
        if (!prev || String(prev?.id || "") !== String(orderId)) return prev;
        return {
          ...prev,
          tracking: {
            ...(prev.tracking || {}),
            stage,
            updatedAt: new Date().toISOString(),
          },
          trackingStage: stage,
        };
      });
    } catch (e) {
      console.error("updateTrackingStage error:", e);
      toast.error(e?.message || "Unable to update tracking");
    } finally {
      setTrackById((p) => ({ ...p, [orderId]: false }));
    }
  };

  const enableShipmentPayment = async (order) => {
    const orderId = String(order?.id || "").trim();
    if (!orderId) return toast.error("Invalid order");
    if (!currentUser) return toast.error("Please sign in");
    if (!isAdmin) return toast.error("Only admin can enable shipment payment");

    try {
      setTrackById((p) => ({ ...p, [`ship_${orderId}`]: true }));

      const { orderPath: guessedPath, fresh } = await fetchFreshOrderDoc(order);
      const o = fresh || order || {};
      const effectiveOrderPath =
        String(o?.orderPath || "").trim() ||
        guessedPath ||
        (o?.userId ? `charex/main/users/${o.userId}/orders/${orderId}` : "");

      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const fee = Number(getShipmentFee(o) || 0);
      if (!fee || fee <= 0) {
        toast.error("No shipment fee found for this order");
        return;
      }

      await setDoc(
        orderDocRef,
        {
          updatedAt: serverTimestamp(),
          shipmentPayment: {
            enabled: true,
            amount: fee,
            state: "unpaid",
            enabledAt: serverTimestamp(),
            enabledBy: currentUser?.uid || null,
          },
        },
        { merge: true }
      );

      toast.success("Shipment payment enabled ✅");

      setSelectedOrder((prev) => {
        if (!prev || String(prev?.id || "") !== String(orderId)) return prev;
        return {
          ...prev,
          shipmentPayment: {
            ...(prev.shipmentPayment || {}),
            enabled: true,
            amount: fee,
            state: String(prev?.shipmentPayment?.state || "unpaid"),
          },
        };
      });
    } catch (e) {
      console.error("enableShipmentPayment error:", e);
      toast.error(e?.message || "Unable to enable shipment payment");
    } finally {
      setTrackById((p) => ({ ...p, [`ship_${orderId}`]: false }));
    }
  };

  const filteredOrders = useMemo(() => {
    const keyword = String(searchKeyword || "").toLowerCase().trim();

    return (orders || [])
      .filter((o) => {
        const pi = getOrderPaidInfo(o);
        const ship = getShipmentPaidInfo(o);
        const bal = getBalancePaidInfo(o);

        const hasOrderMoney = pi.paidAmount > 0 || pi.isMarkedPaid;
        const hasShipMoney = ship.paidTotal > 0 || ship.isPaid || ship.isPartial;
        const hasBalMoney = bal.paidTotal > 0 || bal.isPaid || bal.isPartial;

        return hasOrderMoney || hasShipMoney || hasBalMoney;
      })
      .filter((o) => {
        if (isAdmin) return true;
        return o.userId === currentUser?.uid;
      })
      .filter((order) => {
        if (!keyword) return true;

        const customerName =
          order.customer?.name ||
          order.userName ||
          order.userEmail ||
          "Guest";

        const searchableText = [
          order.id,
          customerName,
          order.customer?.name,
          order.customer?.phone,
          order.customer?.email,
          order.userName,
          order.userEmail,
          order.customer?.address,
          order.shippingAddress?.address,
          order.shippingAddress?.fullAddress,
          order.shippingAddress?.city,
          order.shippingAddress?.state,
          order.shippingAddress?.country,
          order.shippingAddress?.phone,
          order.shippingAddress?.email,
          order.shippingAddress?.firstName,
          order.shippingAddress?.lastName,
          ...(order.cart || []).flatMap((item) => [
            getCartItemSearchText(item),
            getItemDisplayName(item),
            item?.name,
            item?.title,
            item?.productName,
            item?.productTitle,
            item?.productId,
            item?.productID,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(keyword);
      })
      .filter((order) => {
        if (!fromDate && !toDate) return true;

        const orderDate = toDateObject(order.createdAt);
        if (!orderDate) return false;

        if (fromDate && toDate) {
          const from = new Date(
            fromDate.getFullYear(),
            fromDate.getMonth(),
            fromDate.getDate(),
            0,
            0,
            0
          );
          const to = new Date(
            toDate.getFullYear(),
            toDate.getMonth(),
            toDate.getDate(),
            23,
            59,
            59
          );
          return orderDate >= from && orderDate <= to;
        }

        if (fromDate) {
          const from = new Date(
            fromDate.getFullYear(),
            fromDate.getMonth(),
            fromDate.getDate(),
            0,
            0,
            0
          );
          return orderDate >= from;
        }

        if (toDate) {
          const to = new Date(
            toDate.getFullYear(),
            toDate.getMonth(),
            toDate.getDate(),
            23,
            59,
            59
          );
          return orderDate <= to;
        }

        return true;
      });
  }, [orders, isAdmin, currentUser?.uid, fromDate, toDate, shipmentItems, searchKeyword]);

  const bulkBaseOrders = useMemo(() => {
    return filteredOrders.length ? filteredOrders : orders || [];
  }, [filteredOrders, orders]);

  const bulkEligibleOrders = useMemo(() => {
    return (bulkBaseOrders || []).filter((o) => {
      const ship = getShipmentPaidInfo(o);
      const fee = Number(getShipmentFee(o) || 0);
      if (!fee || fee <= 0) return false;
      if (ship.isPaid) return false;
      return true;
    });
  }, [bulkBaseOrders, shipmentItems]);

  const bulkAllEnabled = useMemo(() => {
    if (!bulkEligibleOrders.length) return false;
    return bulkEligibleOrders.every((o) => !!getShipmentPaidInfo(o).enabled);
  }, [bulkEligibleOrders]);

  useEffect(() => {
    setBulkAllToggleState(bulkAllEnabled);
  }, [bulkAllEnabled, bulkEligibleOrders.length]);

  const bulkToggleLabel = useMemo(() => {
    if (!bulkEligibleOrders.length) return "🚚 No Shipment Eligible";
    return bulkAllToggleState ? "🚫 Disable Shipment For All" : "🚚 Enable Shipment For All";
  }, [bulkEligibleOrders.length, bulkAllToggleState]);

  const toggleShipmentForAllOrders = async (desiredEnabled) => {
    if (!currentUser) return toast.error("Please sign in");
    if (!isAdmin) return toast.error("Only admin can toggle shipment payment");
    if (bulkToggleLoading) return;

    try {
      setBulkToggleLoading(true);

      const candidates = bulkEligibleOrders.filter((o) => {
        const ship = getShipmentPaidInfo(o);
        if (desiredEnabled) return !ship.enabled;
        return !!ship.enabled;
      });

      if (!candidates.length) {
        toast.info(
          desiredEnabled
            ? "All eligible orders are already enabled."
            : "All eligible orders are already disabled."
        );
        return;
      }

      const chunks = [];
      const chunkSize = 450;

      for (let i = 0; i < candidates.length; i += chunkSize) {
        chunks.push(candidates.slice(i, i + chunkSize));
      }

      let changedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const chunk of chunks) {
        const batch = writeBatch(db);

        for (const order of chunk) {
          const orderId = String(order?.id || "").trim();
          const userId = String(order?.userId || "").trim();

          const orderPath =
            String(order?.orderPath || "").trim() ||
            (userId && orderId ? `charex/main/users/${userId}/orders/${orderId}` : "");

          const orderDocRef = docRefFromPath(orderPath);
          const fee = Number(getShipmentFee(order) || 0);

          if (!orderDocRef || !fee || fee <= 0) {
            skippedCount += 1;
            continue;
          }

          if (desiredEnabled) {
            batch.set(
              orderDocRef,
              {
                updatedAt: serverTimestamp(),
                shipmentPayment: {
                  enabled: true,
                  amount: fee,
                  state: "unpaid",
                  enabledAt: serverTimestamp(),
                  enabledBy: currentUser?.uid || null,
                  disabledAt: null,
                  disabledBy: null,
                },
              },
              { merge: true }
            );
          } else {
            batch.set(
              orderDocRef,
              {
                updatedAt: serverTimestamp(),
                shipmentPayment: {
                  enabled: false,
                  amount: fee,
                  state: "unpaid",
                  disabledAt: serverTimestamp(),
                  disabledBy: currentUser?.uid || null,
                },
              },
              { merge: true }
            );
          }

          changedCount += 1;
        }

        try {
          await batch.commit();
        } catch (e) {
          console.error("Bulk toggle batch commit failed:", e);
          failedCount += chunk.length;
        }
      }

      if (changedCount > 0) {
        setBulkAllToggleState(!!desiredEnabled);
      }

      setSelectedOrder((prev) => {
        if (!prev) return prev;

        const match = candidates.find((x) => String(x?.id || "") === String(prev?.id || ""));
        if (!match) return prev;

        const fee = Number(getShipmentFee(prev) || 0);
        const next = { ...prev };

        next.shipmentPayment = {
          ...(prev.shipmentPayment || {}),
          enabled: !!desiredEnabled,
          amount: fee,
          state: String(prev?.shipmentPayment?.state || "unpaid"),
        };

        return next;
      });

      toast.success(
        (desiredEnabled ? "Shipment enabled" : "Shipment disabled") +
          ` for ${changedCount} order(s).` +
          (skippedCount ? ` Skipped: ${skippedCount}.` : "") +
          (failedCount ? ` Failed: ${failedCount}.` : "")
      );
    } catch (e) {
      console.error("toggleShipmentForAllOrders error:", e);
      toast.error(e?.message || "Bulk toggle failed");
    } finally {
      setBulkToggleLoading(false);
    }
  };

  const totalOrderPayable = filteredOrders.reduce((sum, o) => {
    const pi = getOrderPaidInfo(o);
    return sum + Number(pi.payableAmount || 0);
  }, 0);

  const totalOrderPayments = filteredOrders.reduce((sum, o) => {
    const pi = getOrderPaidInfo(o);
    return sum + Number(pi.paidAmount || 0);
  }, 0);

  const totalOrderBalance = filteredOrders.reduce((sum, o) => {
    const pi = getOrderPaidInfo(o);
    return sum + Number(pi.balance || 0);
  }, 0);

  const totalShipmentPayments = filteredOrders.reduce((sum, o) => {
    const ship = getShipmentPaidInfo(o);
    return sum + Number(ship.paidTotal || 0);
  }, 0);

  const totalAllPayments = totalOrderPayments + totalShipmentPayments;

  const totalQtySold = filteredOrders.reduce((sum, o) => {
    return sum + getOrderQtySoldForSearch(o, searchKeyword);
  }, 0);

  const totalQtySoldLabel = String(searchKeyword || "").trim()
    ? "Qty Sold (Search Result)"
    : "Qty Sold (All Sold Products)";

  const handlePrintPayments = () => {
    if (!printPaymentsRef.current) {
      toast.error("Nothing to print");
      return;
    }

    try {
      const original = printPaymentsRef.current;
      const clone = original.cloneNode(true);

      const removeUnprintables = (root) => {
        Array.from(root.querySelectorAll(".no-print, .print-hide")).forEach((n) => n.remove());
        Array.from(root.querySelectorAll("button, input, select, textarea")).forEach((n) =>
          n.remove()
        );
        Array.from(root.querySelectorAll("a")).forEach((a) => {
          const txt = (a.textContent || "").trim();
          if (!txt || txt.length < 3) a.remove();
        });
        Array.from(root.querySelectorAll("th.no-print, td.no-print")).forEach((n) => n.remove());
      };

      const cleanupNode = (el) => {
        if (!el) return;

        if (el.style) {
          el.style.maxHeight = "";
          el.style.height = "";
          el.style.overflow = "";
          el.style.overflowY = "";
          el.style.overflowX = "";
          el.style.position = "";
          el.style.top = "";
        }

        try {
          if (el.classList && el.classList.length) {
            el.classList.remove(
              "overflow-x-auto",
              "overflow-y-auto",
              "table-container",
              "max-h-[300px]",
              "sticky",
              "top-0",
              "no-print",
              "print-hide"
            );
          }
        } catch {}

        Array.from(el.children || []).forEach(cleanupNode);
      };

      cleanupNode(clone);
      removeUnprintables(clone);

      const css = `
        @page { margin: 12mm; }
        html, body { height: auto; }
        body { font-family: Arial, sans-serif; padding: 8px; font-size: 12px; color: #000; }
        h2 { text-align: center; margin-bottom: 6px; }
        p { margin: 0 0 6px 0; text-align: center; font-size: 12px; }
        table { width: 100% !important; border-collapse: collapse !important; table-layout: auto !important; word-break: break-word; }
        th, td { border: 1px solid #000 !important; padding: 6px !important; text-align: left; font-size: 11px; vertical-align: middle; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        tbody { display: table-row-group; }
        tr { page-break-inside: auto; page-break-after: auto; }
        td, th { page-break-inside: avoid; }
        .no-print, .print-hide { display: none !important; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          *[style*="max-height"] { max-height: none !important; }
          .sticky, .top-0 { position: static !important; top: auto !important; }
        }
      `;

      const printableHtml = `<!doctype html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <title>Payments Report</title>
            <style>${css}</style>
          </head>
          <body>
            ${clone.innerHTML}
          </body>
        </html>`;

      const printWindow = window.open("", "_blank");

      if (!printWindow) {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        document.body.appendChild(iframe);

        const docu = iframe.contentWindow.document;
        docu.open();
        docu.write(printableHtml);
        docu.close();

        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (err) {
            console.warn("Iframe print failed:", err);
            toast.error("Print failed. Please allow pop-ups or try again.");
          } finally {
            try {
              document.body.removeChild(iframe);
            } catch {}
          }
        }, 700);

        return;
      }

      printWindow.document.open();
      printWindow.document.write(printableHtml);
      printWindow.document.close();

      const tryPrint = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (err) {
          console.warn("Print call failed:", err);
          toast.error("Print failed. Please allow pop-ups or try again.");
        }
      };

      printWindow.onload = () => setTimeout(tryPrint, 300);
      setTimeout(tryPrint, 900);
    } catch (err) {
      console.error("Printing payments failed:", err);
      toast.error("Unable to print payments. Please try again or allow pop-ups.");
    }
  };

  const handleThermalPrintReceipt = () => {
    if (!printReceiptRef.current) return toast.error("Nothing to print");

    try {
      const original = printReceiptRef.current;
      const clone = original.cloneNode(true);

      const trimAfterThankYou = (root) => {
        if (!root) return false;

        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          null,
          false
        );

        let node;

        while ((node = walker.nextNode())) {
          const text = (node.textContent || "").trim();
          if (!text) continue;

          if (text.includes("Thank you for your patronage")) {
            const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (!el) return true;

            let sibling = el.nextSibling;

            while (sibling) {
              const next = sibling.nextSibling;
              sibling.parentNode.removeChild(sibling);
              sibling = next;
            }

            let parent = el.parentElement;

            while (parent && parent !== root) {
              let s = parent.nextSibling;

              while (s) {
                const n = s.nextSibling;
                s.parentNode.removeChild(s);
                s = n;
              }

              parent = parent.parentElement;
            }

            return true;
          }
        }

        return false;
      };

      trimAfterThankYou(clone);

      const css = `
        @page { margin: 8mm; }
        html, body { height: auto; }
        body { font-family: monospace, "Helvetica Neue", Arial, sans-serif; font-size: 13px; padding: 10px; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .receipt-wrapper { max-width: 420px; margin: 0 auto; }
        h3 { text-align: center; margin: 6px 0; font-size: 16px; }
        p { margin: 0 0 8px 0; font-size: 13px; }
        hr { border:none; border-top: 1px dashed #000; margin:8px 0; }
        .row { display:flex; justify-content:space-between; gap:10px; margin-bottom:6px; }
        .total { font-weight:700; font-size:15px; margin-top:8px; display:flex; justify-content:space-between; }
        @media print {
          body { font-size: 13px; }
          .no-print, .print-hide { display: none !important; }
        }
      `;

      const printableHtml = `<!doctype html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <title>Receipt</title>
            <style>${css}</style>
          </head>
          <body>
            <div class="receipt-wrapper">${clone.innerHTML}</div>
          </body>
        </html>`;

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";

      document.body.appendChild(iframe);

      const docu = iframe.contentWindow.document;
      docu.open();
      docu.write(printableHtml);
      docu.close();

      let printed = false;

      setTimeout(() => {
        try {
          if (printed) return;
          printed = true;
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (err) {
          console.warn("Print failed:", err);
          toast.error("Print failed. Please allow pop-ups or try again.");
        } finally {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }
      }, 500);
    } catch (err) {
      console.error("Thermal receipt print failed:", err);
      toast.error("Unable to print receipt. Please try again or allow pop-ups.");
    }
  };

  function goPayShipmentFee(order) {
    if (!currentUser) return toast.error("Please sign in");

    const fee = Number(getShipmentFee(order) || 0);
    if (!fee || fee <= 0) return toast.error("No shipment fee to pay");

    const orderId = String(order?.id || "").trim();
    const orderPath =
      String(order?.orderPath || "").trim() ||
      (order?.userId && orderId ? `users/${order.userId}/orders/${orderId}` : "");

    closeEverything();

    setTimeout(() => {
      navigate(
        `/checkout?mode=shipment&orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(
          String(fee)
        )}`,
        {
          state: {
            mode: "shipment",
            paymentType: "shipment",
            orderId,
            orderPath,
            firestoreNamespace: "charex/main",
            amount: fee,
            total: fee,
            totalAmount: fee,
            shipmentFee: fee,
            label: "Shipment Fee",
            items: [
              {
                name: "Shipment Fee",
                price: fee,
                quantity: 1,
                total: fee,
              },
            ],
          },
        }
      );
    }, 40);
  }

  return (
    <div className="p-6 bg-white rounded-2xl shadow-lg w-full max-w-6xl mx-auto mb-24">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-800">
          {showRepairQueue && isAdmin
            ? "Changed Payment Rows"
            : isAdmin
            ? "Payments Received"
            : "My Payments"}
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setShowRepairQueue((v) => !v)}
              className={`px-3 py-2 rounded text-sm text-white font-semibold ${
                showRepairQueue
                  ? "bg-gray-700 hover:bg-gray-800"
                  : changedRowsCount > 0
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-gray-500 hover:bg-gray-600"
              }`}
            >
              {showRepairQueue
                ? "← Back to Payments"
                : `⚠ Changed Rows (${changedRowsCount})`}
            </button>
          ) : null}

          {isAdmin ? (
            <button
              type="button"
              onClick={() => toggleShipmentForAllOrders(!bulkAllToggleState)}
              disabled={bulkToggleLoading || bulkEligibleOrders.length === 0}
              className={`px-3 py-2 rounded text-sm text-white ${
                bulkToggleLoading || bulkEligibleOrders.length === 0
                  ? "bg-gray-400"
                  : bulkAllToggleState
                  ? "bg-red-700 hover:bg-purple-900"
                  : "bg-purple-700 hover:bg-purple-800"
              }`}
            >
              {bulkToggleLoading ? "Updating..." : bulkToggleLabel}
            </button>
          ) : null}

          <button
            onClick={handlePrintPayments}
            className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
          >
            🖨️ Print Payments
          </button>
        </div>
      </div>

      {isAdmin && showRepairQueue ? (
        <div className="mb-4 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl p-4">
          <div className="font-bold mb-1">Admin correction queue</div>
          <div className="text-sm">
            This queue does not include ordinary pending orders. It only includes payment rows that
            this dashboard first saw as paid with an inflow map today, and later saw as pending with
            the inflow map missing. Customers do not see this repair queue.
          </div>
        </div>
      ) : null}

      {!showRepairQueue ? (
        <div className="flex flex-col md:flex-row gap-4 mb-4 items-center">
        <div className="flex flex-col w-full md:w-auto">
          <label htmlFor="paymentSearch" className="font-semibold text-gray-700">
            Search Name / Order / Product:
          </label>
          <input
            type="text"
            id="paymentSearch"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="Search customer name, phone, email, order ID, product name..."
            className="border p-2 rounded min-w-[280px]"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="fromDate" className="font-semibold text-gray-700">
            From:
          </label>
          <input
            type="date"
            id="fromDate"
            value={fromDate ? fromDate.toISOString().split("T")[0] : ""}
            onChange={(e) => setFromDate(e.target.value ? new Date(e.target.value) : null)}
            className="border p-2 rounded"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="toDate" className="font-semibold text-gray-700">
            To:
          </label>
          <input
            type="date"
            id="toDate"
            value={toDate ? toDate.toISOString().split("T")[0] : ""}
            onChange={(e) => setToDate(e.target.value ? new Date(e.target.value) : null)}
            className="border p-2 rounded"
          />
        </div>

        <button
          onClick={() => {
            setFromDate(null);
            setToDate(null);
            setSearchKeyword("");
          }}
          className="bg-gray-300 hover:bg-gray-400 px-4 py-2 rounded mt-2 md:mt-6"
        >
          Clear Filter
        </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
        <div className="border rounded-xl p-4 bg-gray-50">
          <div className="text-sm text-gray-600">Order Payable (Expected)</div>
          <div className="text-xl font-bold text-gray-900">
            ₦{Number(totalOrderPayable).toLocaleString()}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-gray-50">
          <div className="text-sm text-gray-600">Order Paid (Sum)</div>
          <div className="text-xl font-bold text-gray-900">
            ₦{Number(totalOrderPayments).toLocaleString()}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-amber-50 border-amber-200">
          <div className="text-sm text-amber-700">Order Balance (Outstanding)</div>
          <div className="text-xl font-bold text-amber-800">
            ₦{Number(totalOrderBalance).toLocaleString()}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-green-50 border-green-200">
          <div className="text-sm text-green-700">Total Payments (All)</div>
          <div className="text-xl font-bold text-green-800">
            ₦{Number(totalAllPayments).toLocaleString()}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-blue-50 border-blue-200">
          <div className="text-sm text-blue-700">{totalQtySoldLabel}</div>
          <div className="text-xl font-bold text-blue-800">
            {Number(totalQtySold).toLocaleString()}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-red-50 border-red-200">
          <div className="text-sm text-red-700">Changed Rows</div>
          <div className="text-xl font-bold text-red-800">
            {Number(changedRowsCount).toLocaleString()}
          </div>
          <div className="text-xs text-red-700 mt-1">
            Orders: {Number(changedOrdersCount).toLocaleString()} · ₦
            {Number(changedRowsTotalAmount).toLocaleString()}
          </div>
        </div>
      </div>

      <div
        ref={printPaymentsRef}
        className="table-container overflow-x-auto w-full border border-gray-200 rounded-xl p-2"
      >
        {showRepairQueue && isAdmin ? (
          paymentRepairRows.length === 0 ? (
            <p className="text-gray-600 italic text-center py-10">
              No tracked paid-to-pending rows detected right now.
            </p>
          ) : (
            <div className="table-container overflow-x-auto w-full">
              <table className="min-w-[1700px] w-full border border-gray-200 rounded-xl overflow-hidden">
                <thead className="bg-gradient-to-r from-amber-600 to-red-500 text-white">
                  <tr>
                    <th className="p-3 text-left">SN</th>
                    <th className="p-3 text-left">Issue</th>
                    <th className="p-3 text-left">Order ID</th>
                    <th className="p-3 text-left">Customer</th>
                    <th className="p-3 text-left">Items</th>
                    <th className="p-3 text-left">Current State</th>
                    <th className="p-3 text-left">Amount To Restore</th>
                    <th className="p-3 text-left">VA</th>
                    <th className="p-3 text-left">Reference</th>
                    <th className="p-3 text-left">Tracked / Detected</th>
                    <th className="p-3 text-left no-print">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-200">
                  {paymentRepairRows.map((row, index) => {
                    const order = row.order;
                    const issue = row.issue;
                    const loading = !!repairById[row.key];
                    const tracked = safeFormatDateTime(issue?.trackedAt);
                    const detected = safeFormatDateTime(issue?.detectedAt);

                    return (
                      <tr key={row.key} className="hover:bg-amber-50">
                        <td className="p-3">{index + 1}</td>

                        <td className="p-3">
                          <div className="font-bold text-amber-800">{issue.label}</div>
                          <div className="text-xs text-gray-600 max-w-[280px]">
                            {issue.reason}
                          </div>
                          <span className="inline-block mt-1 px-2 py-1 rounded text-xs bg-red-100 text-red-700">
                            Was paid + inflow today
                          </span>
                        </td>

                        <td className="p-3 font-semibold text-gray-800">
                          {order.id?.slice(0, 10)}...
                        </td>

                        <td className="p-3 text-gray-700">{row.customerName}</td>

                        <td className="p-3 text-gray-700">
                          {order.cart?.map((i) => getItemDisplayName(i)).join(", ") || "—"}
                        </td>

                        <td className="p-3">
                          <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700">
                            {issue.state || "pending"}
                          </span>
                        </td>

                        <td className="p-3 font-bold text-red-700">
                          ₦{Number(issue.restoreAmount || 0).toLocaleString()}
                        </td>

                        <td className="p-3 font-mono">{maskNuban(issue.vaNuban)}</td>

                        <td className="p-3 text-xs text-gray-700">
                          {issue.reference || "—"}
                        </td>

                        <td className="p-3 text-gray-600">
                          <div className="leading-tight text-xs">
                            <div><b>Tracked:</b> {tracked.date} {tracked.time}</div>
                            <div><b>Detected:</b> {detected.date} {detected.time}</div>
                          </div>
                        </td>

                        <td className="p-3 no-print">
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => restoreChangedPaymentRow(row)}
                              disabled={loading}
                              className={`px-3 py-2 rounded text-xs font-semibold text-white ${
                                loading ? "bg-gray-400" : "bg-green-700 hover:bg-green-800"
                              }`}
                            >
                              {loading ? "Correcting..." : "Restore Inflow + Mark Paid"}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedOrder(order);
                                setStageDraft(
                                  String(order?.tracking?.stage || order?.trackingStage || "").trim()
                                );
                              }}
                              className="px-3 py-2 rounded text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800"
                            >
                              View
                            </button>

                            <button
                              type="button"
                              onClick={() => ignoreChangedPaymentRow(row)}
                              className="px-3 py-2 rounded text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300"
                            >
                              Hide Row
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr className="bg-gray-100 font-bold text-gray-800">
                    <td className="p-3 text-left">Totals</td>
                    <td className="p-3" colSpan={5}>
                      Changed Rows: {Number(changedRowsCount).toLocaleString()} · Changed Orders:{" "}
                      {Number(changedOrdersCount).toLocaleString()}
                    </td>
                    <td className="p-3 text-left text-red-700">
                      ₦{Number(changedRowsTotalAmount).toLocaleString()}
                    </td>
                    <td className="p-3" colSpan={3}></td>
                    <td className="p-3 no-print"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : filteredOrders.length === 0 ? (
          <p className="text-gray-600 italic text-center py-10">
            No payments found for selected search/date filter.
          </p>
        ) : (
          <div className="table-container overflow-x-auto w-full">
            <table className="min-w-[2150px] w-full border border-gray-200 rounded-xl overflow-hidden">
              <thead className="bg-gradient-to-r from-purple-700 to-green-600 text-white">
                <tr>
                  <th className="p-3 text-left">SN</th>
                  <th className="p-3 text-left">Order ID</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Items</th>
                  <th className="p-3 text-left">Qty Sold</th>
                  <th className="p-3 text-left">Payable Amt (₦)</th>
                  <th className="p-3 text-left">Paid Amt (Sum) (₦)</th>
                  <th className="p-3 text-left">Balance (₦)</th>
                  <th className="p-3 text-left">Payment</th>
                  <th className="p-3 text-left">Paid Into (VA)</th>
                  <th className="p-3 text-left">Shipment State</th>
                  <th className="p-3 text-left">Shipment Outstanding</th>
                  <th className="p-3 text-left">Balance State</th>
                  <th className="p-3 text-left">Balance Outstanding</th>
                  <th className="p-3 text-left">Tracking</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left no-print">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {filteredOrders.map((o, index) => {
                  const { date, time } = safeFormatDateTime(o.createdAt);
                  const customerName = o.customer?.name || o.userName || o.userEmail || "Guest";
                  const paymentInfo = getOrderPaidInfo(o);
                  const shipInfo = getShipmentPaidInfo(o);
                  const balInfo = getBalancePaidInfo(o);
                  const reconLoading = !!reconById[o.id];
                  const paidInto = getVaNubanFromOrder(o);
                  const trackingStage = TRACKING_LABEL(o);
                  const orderQtySold = getOrderQtySoldForSearch(o, searchKeyword);

                  const payBadge = paymentInfo.isUnderpaid
                    ? "Underpaid"
                    : o.payment?.status || o.orderStatus || "Pending";

                  const showBalanceState =
                    balInfo.enabled ||
                    (balInfo.expected || 0) > 0 ||
                    (balInfo.paidTotal || 0) > 0 ||
                    (balInfo.outstanding || 0) > 0;

                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="p-3">{index + 1}</td>

                      <td className="p-3 font-semibold text-gray-800">
                        {o.id?.slice(0, 8)}...
                      </td>

                      <td className="p-3 text-gray-700">{customerName}</td>

                      <td className="p-3 text-gray-700">
                        {o.cart?.map((i) => getItemDisplayName(i)).join(", ") || "—"}
                      </td>

                      <td className="p-3 font-bold text-blue-700">
                        {Number(orderQtySold || 0).toLocaleString()}
                      </td>

                      <td className="p-3 font-bold">
                        ₦{Number(paymentInfo.payableAmount || 0).toLocaleString()}
                      </td>

                      <td className="p-3 font-semibold">
                        ₦{Number(paymentInfo.paidAmount || 0).toLocaleString()}
                      </td>

                      <td className="p-3">
                        <span
                          className={`font-semibold ${
                            paymentInfo.balance > 0 ? "text-red-700" : "text-green-700"
                          }`}
                        >
                          ₦{Number(paymentInfo.balance || 0).toLocaleString()}
                        </span>
                      </td>

                      <td className="p-3">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`px-2 py-1 rounded text-xs w-fit ${
                              paymentInfo.isUnderpaid
                                ? "bg-orange-100 text-orange-700"
                                : paymentInfo.isMarkedPaid
                                ? "bg-green-100 text-green-700"
                                : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {payBadge}
                          </span>

                          <button
                            type="button"
                            onClick={() => confirmPaymentForOrder(o)}
                            disabled={reconLoading}
                            className={`${
                              reconLoading ? "bg-gray-400" : "bg-green-700 hover:bg-green-800"
                            } text-white px-3 py-2 rounded text-xs font-semibold transition w-fit`}
                          >
                            {reconLoading
                              ? "Checking..."
                              : isAdmin
                              ? "Confirm payment (Admin)"
                              : "I have paid (Confirm)"}
                          </button>
                        </div>
                      </td>

                      <td className="p-3 font-mono text-gray-700">{maskNuban(paidInto)}</td>

                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            shipInfo.isPaid
                              ? "bg-green-100 text-green-700"
                              : shipInfo.isPartial
                              ? "bg-orange-100 text-orange-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {shipInfo.isPaid ? "Paid" : shipInfo.isPartial ? "Partial" : "Not Paid"}
                        </span>
                      </td>

                      <td className="p-3 font-semibold">
                        ₦{Number(shipInfo.outstanding || 0).toLocaleString()}
                      </td>

                      <td className="p-3">
                        {showBalanceState ? (
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              balInfo.isPaid
                                ? "bg-green-100 text-green-700"
                                : balInfo.isPartial
                                ? "bg-orange-100 text-orange-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {balInfo.isPaid ? "Paid" : balInfo.isPartial ? "Partial" : "Pending"}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded text-xs bg-gray-50 text-gray-500">
                            —
                          </span>
                        )}
                      </td>

                      <td className="p-3 font-semibold">
                        ₦{Number(showBalanceState ? balInfo.outstanding : 0).toLocaleString()}
                      </td>

                      <td className="p-3">
                        <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
                          {trackingStage}
                        </span>
                      </td>

                      <td className="p-3 text-gray-600">
                        <div className="leading-tight">
                          <div>{date}</div>
                          {time ? (
                            <div className="text-xs italic text-gray-500">{time}</div>
                          ) : null}
                        </div>
                      </td>

                      <td className="p-3 no-print">
                        <button
                          onClick={() => {
                            setSelectedOrder(o);
                            setStageDraft(
                              String(o?.tracking?.stage || o?.trackingStage || "").trim()
                            );
                          }}
                          className="bg-purple-700 text-white px-3 py-2 rounded text-xs font-semibold"
                        >
                          View/Print
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="bg-gray-100 font-bold text-gray-800">
                  <td className="p-3 text-left">Totals</td>
                  <td className="p-3" colSpan={3}></td>
                  <td className="p-3 text-left text-blue-700">
                    {Number(totalQtySold).toLocaleString()}
                  </td>
                  <td className="p-3 text-left">₦{Number(totalOrderPayable).toLocaleString()}</td>
                  <td className="p-3 text-left">
                    ₦{Number(totalOrderPayments).toLocaleString()}
                  </td>
                  <td className="p-3 text-left">₦{Number(totalOrderBalance).toLocaleString()}</td>
                  <td className="p-3" colSpan={2}></td>
                  <td className="p-3" colSpan={2}>
                    Shipment Paid: ₦{Number(totalShipmentPayments).toLocaleString()}
                  </td>
                  <td className="p-3" colSpan={3}>
                    Total All: ₦{Number(totalAllPayments).toLocaleString()}
                  </td>
                  <td className="p-3 no-print"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50">
          <div className="min-h-screen w-full flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white w-full max-w-md rounded-lg relative shadow-lg max-h-[85vh] flex flex-col">
              <div className="sticky top-0 bg-white z-10 border-b px-6 py-4 rounded-t-lg flex items-center justify-between">
                <div className="font-bold text-gray-800">
                  {isAdmin ? "Receipt + Admin Controls" : "Receipt"}
                </div>

                <button
                  type="button"
                  className="text-red-500"
                  onClick={closeEverything}
                  aria-label="Close"
                >
                  <IoClose size={24} />
                </button>
              </div>

              <div className="px-6 py-4 overflow-y-auto">
                {(() => {
                  const ship = getShipmentPaidInfo(selectedOrder);
                  const bal = getBalancePaidInfo(selectedOrder);
                  const pi = getOrderPaidInfo(selectedOrder);
                  const shipFee = getShipmentFee(selectedOrder);
                  const fee = Number(shipFee || 0);
                  const enabled = !!selectedOrder?.shipmentPayment?.enabled;
                  const stage = String(
                    selectedOrder?.tracking?.stage || selectedOrder?.trackingStage || ""
                  ).trim();
                  const stageMakesReady = stage === "Out for delivery";
                  const canPay = (enabled || stageMakesReady) && fee > 0 && !ship.isPaid;
                  const reconLoading = !!reconById[selectedOrder.id];

                  const showBalanceLine =
                    bal.enabled ||
                    (bal.expected || 0) > 0 ||
                    (bal.paidTotal || 0) > 0 ||
                    (bal.outstanding || 0) > 0;

                  return (
                    <>
                      <div ref={printReceiptRef} style={{ textAlign: "center" }}>
                        <h3>CHAREX</h3>
                        <p>0703 338 9736</p>
                        <p>44 Lumac Street, Satellite Town, Lagos</p>

                        <hr />

                        <h3>ORDER RECEIPT</h3>

                        <hr />

                        <div style={{ textAlign: "left" }}>
                          <p>
                            <b>Order ID:</b> {selectedOrder.id?.slice(0, 10)}
                          </p>

                          <p>
                            <b>Date:</b> {formatDateShort(selectedOrder.createdAt)}
                            <br />
                            <span style={{ fontSize: "11px", fontStyle: "italic" }}>
                              {formatTimeShort(selectedOrder.createdAt)}
                            </span>
                          </p>

                          <p>
                            <b>Customer:</b>{" "}
                            {selectedOrder.customer?.name ||
                              selectedOrder.userName ||
                              selectedOrder.userEmail ||
                              "Guest"}
                          </p>

                          <p>
                            <b>Phone:</b> {selectedOrder.customer?.phone || "N/A"}
                          </p>

                          <p>
                            <b>Address:</b>{" "}
                            {selectedOrder.customer?.address ||
                              [
                                selectedOrder.shippingAddress?.address,
                                selectedOrder.shippingAddress?.city,
                                selectedOrder.shippingAddress?.state,
                                selectedOrder.shippingAddress?.country,
                              ]
                                .filter(Boolean)
                                .join(", ") ||
                              "N/A"}
                          </p>

                          <p>
                            <b>Paid Into (VA):</b>{" "}
                            {maskNuban(getVaNubanFromOrder(selectedOrder))}
                          </p>

                          <p>
                            <b>Tracking:</b> {TRACKING_LABEL(selectedOrder)}
                          </p>

                          <p>
                            <b>Shipment:</b>{" "}
                            {ship.isPaid ? "Paid" : ship.isPartial ? "Partial" : "Not Paid"}{" "}
                            {ship.expected
                              ? `— Expected ₦${Number(ship.expected).toLocaleString()}`
                              : ""}{" "}
                            {ship.paidTotal
                              ? `— Paid ₦${Number(ship.paidTotal).toLocaleString()}`
                              : ""}{" "}
                            {ship.outstanding
                              ? `— Outstanding ₦${Number(ship.outstanding).toLocaleString()}`
                              : ""}
                          </p>

                          {showBalanceLine ? (
                            <p>
                              <b>Balance Payment:</b>{" "}
                              {bal.isPaid ? "Paid" : bal.isPartial ? "Partial" : "Pending"}{" "}
                            </p>
                          ) : null}

                          <p>
                            <b>Payable Amount:</b>{" "}
                            ₦{Number(pi.payableAmount || 0).toLocaleString()}
                          </p>

                          <p>
                            <b>Paid Amount (Sum):</b>{" "}
                            ₦{Number(pi.paidAmount || 0).toLocaleString()}
                          </p>

                          <p>
                            <b>Balance:</b>{" "}
                            <span style={{ fontWeight: "bold" }}>
                              ₦{Number(pi.balance || 0).toLocaleString()}
                            </span>
                          </p>
                        </div>

                        <hr />

                        {selectedOrder.cart?.map((item, i) => (
                          <div key={i} style={{ marginBottom: "6px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>
                                {getItemDisplayName(item)} × {item.quantity}
                              </span>
                              <span>
                                ₦
                                {(
                                  (Number(item.price) || 0) * (Number(item.quantity) || 0)
                                ).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}

                        <hr />

                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Items Subtotal</span>
                          <span>
                            ₦{(Number(selectedOrder.totalAmount) || 0).toLocaleString()}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                          }}
                        >
                          <span>Delivery</span>
                          <span>₦{Number(getShipmentFee(selectedOrder) || 0).toLocaleString()}</span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                          }}
                        >
                          <span>Base Total</span>
                          <span>₦{Number(getBaseBeforeVat(selectedOrder) || 0).toLocaleString()}</span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                          }}
                        >
                          <span>VAT</span>
                          <span>₦{Number(getVatAmount(selectedOrder) || 0).toLocaleString()}</span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontWeight: "bold",
                            marginTop: "6px",
                            fontSize: "14px",
                          }}
                        >
                          <span>TOTAL (Incl. VAT)</span>
                          <span>₦{Number(getPayableTotal(selectedOrder) || 0).toLocaleString()}</span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                          }}
                        >
                          <span>PAID (Sum)</span>
                          <span>₦{Number(pi.paidAmount || 0).toLocaleString()}</span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "4px",
                            fontWeight: "bold",
                          }}
                        >
                          <span>BALANCE</span>
                          <span>₦{Number(pi.balance || 0).toLocaleString()}</span>
                        </div>

                        <hr />

                        <p>Thank you for your patronage 🙏</p>
                      </div>

                      <button
                        onClick={handleThermalPrintReceipt}
                        className="mt-4 bg-black text-white w-full py-2 rounded"
                      >
                        🖨️ Print Receipt
                      </button>

                      <div className="mt-4 border-t pt-4">
                        <h4 className="font-bold text-gray-800 mb-2">Shipment Fee</h4>

                        <div className="text-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span>
                              Fee: <b>₦{fee.toLocaleString()}</b>
                            </span>
                            <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">
                              {ship.isPaid
                                ? "paid"
                                : canPay
                                ? "payable"
                                : enabled
                                ? "enabled"
                                : "not enabled"}
                            </span>
                          </div>

                          {isAdmin ? (
                            <>
                              <button
                                type="button"
                                onClick={() => enableShipmentPayment(selectedOrder)}
                                disabled={!!trackById[`ship_${selectedOrder.id}`]}
                                className={`w-full py-2 rounded text-white font-semibold ${
                                  !!trackById[`ship_${selectedOrder.id}`]
                                    ? "bg-gray-400"
                                    : "bg-purple-700 hover:bg-purple-800"
                                }`}
                              >
                                {!!trackById[`ship_${selectedOrder.id}`]
                                  ? "Enabling..."
                                  : enabled
                                  ? "Shipment Payment Enabled"
                                  : "Enable Shipment Fee Payment"}
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleShipmentForAllOrders(!bulkAllToggleState)}
                                disabled={bulkToggleLoading || bulkEligibleOrders.length === 0}
                                className={`mt-3 w-full py-2 rounded text-white font-semibold ${
                                  bulkToggleLoading || bulkEligibleOrders.length === 0
                                    ? "bg-gray-400"
                                    : bulkAllToggleState
                                    ? "bg-red-700 hover:bg-purple-900"
                                    : "bg-purple-900 hover:bg-purple-950"
                                }`}
                              >
                                {bulkToggleLoading ? "Updating..." : bulkToggleLabel}
                              </button>
                            </>
                          ) : (
                            <div className="text-xs text-gray-600">
                              {enabled || stageMakesReady
                                ? "You can pay the shipment fee when it becomes payable."
                                : "Shipment fee payment is not enabled yet."}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => goPayShipmentFee(selectedOrder)}
                            disabled={!canPay}
                            className={`mt-3 w-full py-2 rounded text-white font-semibold ${
                              canPay ? "bg-green-700 hover:bg-green-800" : "bg-gray-300"
                            }`}
                          >
                            Pay Shipment Fee Now
                          </button>
                        </div>
                      </div>

                      {isAdmin ? (
                        <div className="mt-4 border-t pt-4">
                          <h4 className="font-bold text-gray-800 mb-2">Tracking / Stage</h4>

                          <div className="flex gap-2 items-center">
                            <select
                              value={stageDraft}
                              onChange={(e) => setStageDraft(e.target.value)}
                              className="border rounded px-3 py-2 w-full"
                            >
                              <option value="">Select stage...</option>
                              {TRACKING_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => updateTrackingStage(selectedOrder, stageDraft)}
                              disabled={!!trackById[selectedOrder.id]}
                              className={`px-3 py-2 rounded text-white text-sm font-semibold ${
                                !!trackById[selectedOrder.id]
                                  ? "bg-gray-400"
                                  : "bg-blue-700 hover:bg-blue-800"
                              }`}
                            >
                              {!!trackById[selectedOrder.id] ? "Saving..." : "Update"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => confirmPaymentForOrder(selectedOrder)}
                        disabled={reconLoading}
                        className={`mt-4 w-full py-2 rounded text-white font-semibold transition ${
                          reconLoading ? "bg-gray-400" : "bg-green-700 hover:bg-green-800"
                        }`}
                      >
                        {reconLoading
                          ? "Checking..."
                          : isAdmin
                          ? "Confirm payment (Admin)"
                          : "I have paid (Confirm)"}
                      </button>

                      <button
                        type="button"
                        onClick={closeEverything}
                        className="mt-3 w-full py-2 rounded bg-purple-700 text-white font-semibold"
                      >
                        Close
                      </button>
                    </>
                  );
                })()}
              </div>

              <div className="h-2" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentsComponent;