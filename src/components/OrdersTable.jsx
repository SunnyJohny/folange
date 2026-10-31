import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useMyContext } from "../Context/MyContext";
import { IoClose } from "react-icons/io5";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp, arrayUnion } from "firebase/firestore";

// ------------------------------------------------------------
// ✅ CHAREX FIRESTORE ORDER PATH
// ------------------------------------------------------------
// Orders are stored at:
// charex/main/users/{uid}/orders/{orderId}
const getCharexOrderPath = (userId, orderId) => {
  const uid = String(userId || "").trim();
  const oid = String(orderId || "").trim();

  if (!uid || !oid) return "";
  return `charex/main/users/${uid}/orders/${oid}`;
};

const OrdersTable = ({ onClose }) => {
  const {
    orders = [],
    currentUser,
    shipmentItems = [],
    closeAllDashboardModals,
    refreshAdminOrders, // ✅ NEW from context
  } = useMyContext();

  const navigate = useNavigate();

  // ✅ local mirror so table updates instantly when actions happen
  const [localOrders, setLocalOrders] = useState([]);
  useEffect(() => setLocalOrders(Array.isArray(orders) ? orders : []), [orders]);

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // ✅ NEW: search by customer name, phone, email, order ID, and item names
  const [searchKeyword, setSearchKeyword] = useState("");

  // ✅ per-order reconcile loading
  const [reconById, setReconById] = useState({});

  // ✅ small cooldown to stop repeated confirm spam
  const [confirmCooldown, setConfirmCooldown] = useState({});

  // ✅ per-order tracking update loading
  const [trackById, setTrackById] = useState({});

  // ✅ stage selected in modal
  const [stageDraft, setStageDraft] = useState("");

  // ✅ admin: shipping fee edit draft
  const [shipFeeDraft, setShipFeeDraft] = useState("");
  const [shipFeeSaving, setShipFeeSaving] = useState(false);

  // ✅ Manual payment field repair for old flipped orders.
  // Used when an order flipped from paid/partial back to pending before the tracker existed.
  const [manualRepairMode, setManualRepairMode] = useState("order");
  const [manualRepairStatus, setManualRepairStatus] = useState("partial");
  const [manualRepairAmount, setManualRepairAmount] = useState("");
  const [manualRepairExpected, setManualRepairExpected] = useState("");
  const [manualRepairPaymentReference, setManualRepairPaymentReference] = useState("");
  const [manualRepairCustomerReference, setManualRepairCustomerReference] = useState("");
  const [manualRepairSaving, setManualRepairSaving] = useState(false);

  const printRef = useRef(null);
  const printAllRef = useRef(null);

  const isAdmin = currentUser?.role === "admin";
  const PAYMENT_REPAIR_EMAILS = useMemo(
    () => ["blessingumeh63@gmail.com", "test5@gmail.com"],
    []
  );
  const currentUserEmail = String(currentUser?.email || "").trim().toLowerCase();
  const canRepairPaymentFields =
    isAdmin || PAYMENT_REPAIR_EMAILS.includes(currentUserEmail);

  const TRACKING_STAGES = useMemo(
    () => [
      "Processing",
      "Out for delivery",
      "Stockpiled",
      "Picked up",
      "Part delivery",
      "Delivered",
    ],
    []
  );

  // ✅ For admin, load orders only when this table is opened
  useEffect(() => {
    if (!isAdmin) return;
    if (typeof refreshAdminOrders !== "function") return;

    refreshAdminOrders();
  }, [isAdmin, refreshAdminOrders]);

  // ✅ Lock background scroll when receipt modal opens
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

    if (typeof onClose === "function") {
      try {
        onClose();
      } catch (e) {
        console.warn("onClose failed:", e?.message || e);
      }
    }

    try {
      window.dispatchEvent(new Event("close-all-dashboard-modals"));
    } catch {}
  }, [closeAllDashboardModals, onClose]);

  const closeEverything = useCallback(() => {
    setSelectedOrder(null);
    setStageDraft("");
    setShipFeeDraft("");

    try {
      document.body.style.overflow = "";
    } catch {}

    forceCloseDashboardShell();

    setTimeout(() => {
      forceCloseDashboardShell();
      try {
        document.body.style.overflow = "";
      } catch {}
    }, 0);
  }, [forceCloseDashboardShell]);

  const hardGoCheckout = useCallback((urlPath, payload) => {
    try {
      sessionStorage.setItem("charex_checkout_payload", JSON.stringify(payload || {}));
    } catch {}

    try {
      window.location.assign(urlPath);
    } catch (e) {
      console.warn("window.location.assign failed:", e);
      window.location.href = urlPath;
    }
  }, []);

  // -------------------- VARIANTS (PRINT + TABLE) --------------------
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
    const name = item?.name || item?.title || "Item";
    const vObj = normalizeVariants(item);
    const vText = formatVariantsText(vObj);
    return vText ? `${name} (${vText})` : name;
  };


  // ✅ Product-aware search + quantity helpers
  const getItemQuantity = (item = {}) => {
    const qty =
      toNum(item?.quantity) ||
      toNum(item?.qty) ||
      toNum(item?.cartQuantity) ||
      toNum(item?.count) ||
      0;
    return Math.max(0, qty);
  };

  const getItemSearchText = (item = {}) => {
    const vObj = normalizeVariants(item);
    const vText = formatVariantsText(vObj);

    return [
      item?.name,
      item?.title,
      item?.productName,
      item?.productTitle,
      item?.productId,
      item?.productID,
      item?.id,
      item?.sku,
      item?.category,
      item?.subCategory,
      item?.brand,
      item?.variant,
      item?.variantName,
      item?.variantText,
      item?.selectedColor,
      item?.selectedSize,
      item?.color,
      item?.size,
      vText,
      getItemDisplayName(item),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  };

  const getOrderQuantityForSearch = (order = {}, keywordValue = searchKeyword) => {
    const cart = Array.isArray(order?.cart) ? order.cart : [];
    const keyword = String(keywordValue || "").toLowerCase().trim();

    if (!cart.length) return 0;

    if (keyword) {
      const matchedItems = cart.filter((item) => getItemSearchText(item).includes(keyword));
      if (matchedItems.length) {
        return matchedItems.reduce((sum, item) => sum + getItemQuantity(item), 0);
      }
    }

    return cart.reduce((sum, item) => sum + getItemQuantity(item), 0);
  };

  const orderHasPaymentCommitment = (order = {}) => {
    const pi = getOrderPaidInfo(order);
    const ship = getShipmentPaidInfo(order);
    const bal = getBalancePaidInfo(order);

    const paymentInflow = order?.payment?.inflow || {};
    const mainPaymentHasMoney =
      pi.isMarkedPaid ||
      pi.paidAmount > 0 ||
      toNum(order?.payment?.amountPaid) > 0 ||
      toNum(paymentInflow?.paidTotal) > 0 ||
      toNum(paymentInflow?.amountNormalized) > 0 ||
      toNum(paymentInflow?.amount) > 0 ||
      !!order?.payment?.paidAt;

    const shipmentHasMoney = ship.isPaid || ship.isPartial || ship.paidTotal > 0;
    const balanceHasMoney = bal.isPaid || bal.isPartial || bal.paidTotal > 0;

    return mainPaymentHasMoney || shipmentHasMoney || balanceHasMoney;
  };

  const isPendingWithoutPaymentCommitment = (order = {}) => {
    const status = String(order?.payment?.status || order?.orderStatus || order?.status || "")
      .trim()
      .toLowerCase();

    const looksPending =
      !status ||
      status === "pending" ||
      status === "unpaid" ||
      status === "not paid" ||
      status === "awaiting payment" ||
      status.includes("pending");

    return looksPending && !orderHasPaymentCommitment(order);
  };

  // -------------------- SHIPMENT FEE --------------------
  const shipmentFeeMap = useMemo(() => {
    const map = new Map();
    (shipmentItems || []).forEach((it) => {
      const n = String(it?.name || "").toLowerCase().trim();
      if (n) map.set(n, Number(it?.shipmentFee || 0));
    });
    return map;
  }, [shipmentItems]);

  const getShipmentFee = (order) => {
    const stored = Number(order?.shipmentPayment?.amount || 0);
    if (stored > 0) return stored;

    if (!order?.cart || order.cart.length === 0) {
      return Number(order?.shipmentFee || 0);
    }

    for (const c of order.cart) {
      const nm = String(c?.name || c?.title || "").toLowerCase().trim();
      if (!nm) continue;
      if (shipmentFeeMap.has(nm)) return Number(shipmentFeeMap.get(nm) || 0);
    }

    return Number(order?.shipmentFee || 0);
  };

  // -------------------- SAFE NUMBER NORMALIZATION --------------------
  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

  const getShipmentPaidInfo = (order) => {
    const sp = order?.shipmentPayment || {};
    const state =
      String(sp?.state || sp?.payment?.state || "").trim().toLowerCase() || "";
    const isPaid = state === "paid";
    const isPartial = state === "partial";

    const expected =
      toNum(sp?.payment?.amount) ||
      toNum(sp?.payableTotal) ||
      toNum(sp?.amount) ||
      toNum(order?.shipmentFee) ||
      toNum(getShipmentFee(order));

    const paidTotal = toNum(sp?.amountPaid) || toNum(sp?.payment?.amountPaid) || 0;

    const outstanding =
      // toNum(sp?.outstanding) ||
      toNum(sp?.payment?.outstanding) ||
      Math.max(0, expected - paidTotal);

    const inflowAmtRaw = sp?.payment?.inflow?.paidTotal ?? sp?.payment?.inflow?.amount;
    const inflowAmt = toNum(inflowAmtRaw);

    return {
      state: state || (sp?.enabled ? "enabled" : "not enabled"),
      isPaid,
      isPartial,
      expected,
      paidTotal: paidTotal || (Number.isFinite(inflowAmt) ? inflowAmt : 0),
      outstanding,
      paidAt: sp?.paidAt || sp?.payment?.paidAt || null,
    };
  };

  const getBalancePaidInfo = (order) => {
    const bp = order?.balancePayment || {};
    const stateRaw =
      String(bp?.state || bp?.payment?.state || "").trim().toLowerCase() || "";

    const expected =
      toNum(bp?.payment?.amount) || toNum(bp?.payableTotal) || toNum(bp?.amount) || 0;

    const inflowAmtRaw = bp?.payment?.inflow?.paidTotal ?? bp?.payment?.inflow?.amount;
    const inflowAmt = toNum(inflowAmtRaw);

    const paidTotal =
      toNum(bp?.amountPaid) ||
      toNum(bp?.payment?.amountPaid) ||
      (Number.isFinite(inflowAmt) ? inflowAmt : 0) ||
      0;

    const outstandingFromData =
      toNum(bp?.outstanding) || toNum(bp?.payment?.outstanding) || 0;

    const calculatedOutstanding = Math.max(0, expected - paidTotal);

    const isPaid =
      stateRaw === "paid" || (expected > 0 && paidTotal >= expected);

    const isPartial =
      !isPaid &&
      (stateRaw === "partial" || (expected > 0 && paidTotal > 0 && paidTotal < expected));

    const normalizedState = isPaid
      ? "paid"
      : isPartial
      ? "partial"
      : stateRaw || (bp?.enabled ? "enabled" : "not enabled");

    const outstanding = isPaid
      ? 0
      : outstandingFromData || calculatedOutstanding;

    return {
      state: normalizedState,
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
      0;

    const balanceInfo = getBalancePaidInfo(order);
    const balanceExpected = Number(balanceInfo.expected || 0);
    const balancePaid = Number(balanceInfo.paidTotal || 0);

    // ✅ Receipt fix:
    // If balancePayment is fully paid, do not let old main-payment outstanding
    // keep the receipt balance open. Treat the whole order as settled.
    const balanceCleared =
      balanceInfo.isPaid || (balanceExpected > 0 && balancePaid >= balanceExpected);

    const totalPaidAmount = balanceCleared
      ? payableAmount
      : Math.min(payableAmount, mainPaidAmount + balancePaid);

    const outstanding = balanceCleared
      ? 0
      : Math.max(0, payableAmount - totalPaidAmount);

    const basePaidAmount =
      toNum(rawPayload?.baseToPay) ||
      toNum(rawPayload?.payableBase) ||
      toNum(order?.grandTotal) ||
      toNum(order?.totalAmount) ||
      0;

    const statusRaw = String(order?.payment?.status || order?.orderStatus || "").trim();
    const status = statusRaw.toLowerCase();

    const isMarkedPaid =
      status === "paid" ||
      status === "success" ||
      !!order?.payment?.paidAt ||
      String(order?.orderStatus || "").toLowerCase() === "paid" ||
      balanceCleared ||
      (payableAmount > 0 && totalPaidAmount >= payableAmount);

    const isUnderpaid =
      payableAmount > 0 && totalPaidAmount > 0 && totalPaidAmount < payableAmount;

    return {
      payableAmount: payableAmount || 0,
      paidAmount: totalPaidAmount || 0,
      basePaidAmount: basePaidAmount || 0,
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

  // -------------------- DATE FILTER + SEARCH FILTER --------------------
  const filteredOrders = useMemo(() => {
    const keyword = searchKeyword.toLowerCase().trim();

    return localOrders.filter((order) => {
      const customerName = order.customer?.name || order.userName || order.userEmail || "Guest";

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
        ...(order.cart || []).map((item) => getItemSearchText(item)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !keyword || searchableText.includes(keyword);

      if (!matchesSearch) return false;

      if (!fromDate && !toDate) return true;
      if (!order.createdAt) return false;

      const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);

      const from = fromDate ? new Date(fromDate) : null;
      const to = toDate ? new Date(toDate) : null;

      if (from) from.setHours(0, 0, 0, 0);
      if (to) to.setHours(23, 59, 59, 999);

      if (from && to) return orderDate >= from && orderDate <= to;
      if (from) return orderDate >= from;
      if (to) return orderDate <= to;
      return true;
    });
  }, [localOrders, fromDate, toDate, searchKeyword]);

  // -------------------- TOTALS --------------------
  const totals = useMemo(() => {
    const totalRevenue = filteredOrders.reduce(
      (sum, o) => sum + (Number(getPayableTotal(o)) || 0),
      0
    );

    const paidOrders = filteredOrders.filter((o) => {
      const pi = getOrderPaidInfo(o);
      return pi.isMarkedPaid || pi.paidAmount > 0;
    });

    const paidRevenue = paidOrders.reduce((sum, o) => {
      const pi = getOrderPaidInfo(o);
      return sum + (Number(pi.paidAmount) || 0);
    }, 0);

    const totalOutstanding = filteredOrders.reduce((sum, o) => {
      const pi = getOrderPaidInfo(o);
      return sum + (Number(pi.balance) || 0);
    }, 0);

    const totalQuantity = filteredOrders.reduce((sum, o) => {
      return sum + getOrderQuantityForSearch(o, searchKeyword);
    }, 0);

    const pendingWithoutCommitment = filteredOrders.filter((o) =>
      isPendingWithoutPaymentCommitment(o)
    ).length;

    return {
      totalRevenue,
      paidRevenue,
      totalOutstanding,
      totalQuantity,
      pendingWithoutCommitment,
    };
  }, [filteredOrders, searchKeyword]);

  // -------------------- HELPERS FOR CLEAN PRINT DOM --------------------
  const cleanupNodeStylesAndClasses = (el) => {
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
    Array.from(el.children || []).forEach(cleanupNodeStylesAndClasses);
  };

  const removeInteractiveElements = (root) => {
    if (!root || !(root.querySelectorAll)) return;
    // remove specific control nodes
    Array.from(root.querySelectorAll(".no-print, .print-hide")).forEach((n) => n.remove());
    Array.from(root.querySelectorAll("button, input, select, textarea")).forEach((n) => {
      const txt = (n.textContent || n.value || "").trim();
      if (txt) {
        const span = document.createElement("span");
        span.textContent = txt;
        span.style.display = "inline-block";
        n.parentNode?.replaceChild(span, n);
      } else {
        n.remove();
      }
    });
    Array.from(root.querySelectorAll("a")).forEach((a) => {
      const txt = (a.textContent || "").trim();
      if (!txt || txt.length < 3) a.remove();
      else {
        const span = document.createElement("span");
        span.textContent = txt;
        a.parentNode?.replaceChild(span, a);
      }
    });
  };

  // -------------------- MOBILE SAFE THERMAL PRINT --------------------
  const handleThermalPrint = () => {
    if (!printRef.current) return toast.error("Nothing to print");

    try {
      const original = printRef.current;
      const clone = original.cloneNode(true);

      // Trim clone to stop after the "Thank you for your patronage" line.
      const trimAfterThankYou = (root) => {
        if (!root) return false;
        // find element or text node containing the phrase
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const text = (node.textContent || "").trim();
          if (!text) continue;
          if (text.includes("Thank you for shopping with CHAREX")) {
            // find parent element to stop after
            const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (!el) return true;

            // remove all siblings after el
            let sibling = el.nextSibling;
            while (sibling) {
              const next = sibling.nextSibling;
              sibling.parentNode.removeChild(sibling);
              sibling = next;
            }
            // climb up and cut following siblings from ancestors so everything after block is removed
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
      cleanupNodeStylesAndClasses(clone);
      removeInteractiveElements(clone);

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
            <title>CHAREX Receipt</title>
            <style>${css}</style>
          </head>
          <body>
            <div class="receipt-wrapper">${clone.innerHTML}</div>
          </body>
        </html>`;

      // use iframe to avoid popup blockers and ensure single print call
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
      console.error("Thermal print failed:", err);
      toast.error("Unable to print receipt. Please try again or allow pop-ups.");
    }
  };

  // -------------------- PRINT ALL FILTERED ORDERS --------------------
  const handlePrintAllOrders = () => {
    if (!printAllRef.current) return toast.error("Nothing to print");

    try {
      const original = printAllRef.current;
      const clone = original.cloneNode(true);

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

      const removeUnprintables = (root) => {
        Array.from(root.querySelectorAll(".no-print")).forEach((n) => n.remove());
        Array.from(root.querySelectorAll("button, input, select, textarea")).forEach((b) => {
          const txt = (b.textContent || b.value || "").trim();
          if (txt) {
            const span = document.createElement("span");
            span.textContent = txt;
            b.parentNode?.replaceChild(span, b);
          } else {
            b.remove();
          }
        });
        Array.from(root.querySelectorAll("a")).forEach((a) => {
          const txt = (a.textContent || "").trim();
          if (!txt || txt.length < 3) a.remove();
          else {
            const span = document.createElement("span");
            span.textContent = txt;
            a.parentNode?.replaceChild(span, a);
          }
        });
        Array.from(root.querySelectorAll("th, td")).forEach((cell) => {
          if ((cell.className || "").includes("no-print")) cell.remove();
        });
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
        img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
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
            <title>Orders Report</title>
            <style>${css}</style>
          </head>
          <body>
            ${clone.innerHTML}
          </body>
        </html>`;

      // prefer popup window, but ensure single print invocation; fallback to iframe if blocked
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

        let printed = false;
        setTimeout(() => {
          try {
            if (printed) return;
            printed = true;
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

      // guard so we only call print once
      let printed = false;
      const tryPrint = () => {
        if (printed) return;
        printed = true;
        try {
          printWindow.focus();
          printWindow.print();
        } catch (err) {
          console.warn("Print call failed:", err);
          toast.error("Print failed. Please allow pop-ups or try again.");
        } finally {
          try {
            printWindow.close();
          } catch {}
        }
      };

      printWindow.onload = () => setTimeout(tryPrint, 300);
      setTimeout(() => tryPrint(), 1200);
    } catch (err) {
      console.error("Printing failed:", err);
      toast.error("Unable to print orders. Please try again or allow pop-ups.");
    }
  };

  const safeFormatDate = (val) => {
    if (!val) return "-";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d)) return "-";
      return d.toLocaleDateString();
    } catch {
      return "-";
    }
  };

  const safeFormatTime = (val) => {
    if (!val) return "";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      if (isNaN(d)) return "";
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const safeFormatDateTime = (val) => ({
    date: safeFormatDate(val),
    time: safeFormatTime(val),
  });

  const formatYyyyMmDd = (d) => {
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
      o?.vasVirtualAccount?.vNUBAN ||
      o?.vasVirtualAccount?.vaNuban ||
      "";
    return String(raw).replace(/\D/g, "").trim();
  };

  const maskNuban = (nuban) => {
    const x = String(nuban || "").replace(/\D/g, "");
    if (!x) return "-";
    if (x.length < 6) return x;
    return `${x.slice(0, 3)}****${x.slice(-4)}`;
  };

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

  const getEffectiveOrderPath = (order) => {
    const orderId = String(order?.id || "").trim();
    const userId = String(order?.userId || "").trim();

    const storedPath = String(order?.orderPath || "").trim();

    // Accept an already-correct CHAREX path. If an old users/{uid}/orders/{id}
    // path is found on a legacy order, rebuild it using the new CHAREX structure.
    if (storedPath.startsWith("charex/main/users/")) {
      return storedPath;
    }

    return getCharexOrderPath(userId, orderId);
  };

  const patchOrderEverywhere = useCallback((orderId, patchFn) => {
    const id = String(orderId || "").trim();
    if (!id) return;

    setLocalOrders((prev) =>
      (Array.isArray(prev) ? prev : []).map((o) => {
        if (String(o?.id || "") !== id) return o;
        const next =
          typeof patchFn === "function" ? patchFn(o) : { ...o, ...(patchFn || {}) };
        return next || o;
      })
    );

    setSelectedOrder((prev) => {
      if (!prev || String(prev?.id || "") !== id) return prev;
      const next =
        typeof patchFn === "function" ? patchFn(prev) : { ...prev, ...(patchFn || {}) };
      return next || prev;
    });
  }, []);

  const pickConfirmMode = (o) => {
    const bal = o?.balancePayment || {};
    const balState = String(bal?.state || bal?.payment?.state || "").toLowerCase();
    const balEnabled = !!bal?.enabled;
    const balNotPaid = balState !== "paid";
    if (balEnabled && balNotPaid) return "balance";

    const ship = o?.shipmentPayment || {};
    const shipState = String(ship?.state || ship?.payment?.state || "").toLowerCase();
    const shipEnabled = !!ship?.enabled;
    const shipNotPaid = shipState !== "paid";
    if (shipEnabled && shipNotPaid) return "shipment";

    return "order";
  };

  const getVaForMode = (o, mode) => {
    if (mode === "balance") {
      return String(o?.balancePayment?.payment?.vaNuban || o?.balancePayment?.payment?.vaNUBAN || "")
        .replace(/\D/g, "")
        .trim();
    }
    if (mode === "shipment") {
      return String(o?.shipmentPayment?.payment?.vaNuban || o?.shipmentPayment?.payment?.vaNUBAN || "")
        .replace(/\D/g, "")
        .trim();
    }
    return String(o?.payment?.vaNuban || o?.payment?.vNUBAN || o?.payment?.vaNUBAN || "")
      .replace(/\D/g, "")
      .trim();
  };

  const confirmPaymentForOrder = async (order) => {
    const orderId = String(order?.id || "").trim();

    try {
      if (!orderId) return toast.error("Invalid order");
      if (!currentUser) return toast.error("Please sign in");

      const lastCheck = confirmCooldown[orderId] || 0;
      if (Date.now() - lastCheck < 15000) {
        toast.info("Please wait a few seconds before confirming again.");
        return;
      }

      setReconById((p) => ({ ...p, [orderId]: true }));
      setConfirmCooldown((p) => ({ ...p, [orderId]: Date.now() }));

      const o = order || {};
      const effectiveOrderPath = getEffectiveOrderPath(o);

      if (!effectiveOrderPath) {
        toast.error("Order path missing (cannot confirm)");
        return;
      }

      const mode = pickConfirmMode(o);
      let vNUBAN = getVaForMode(o, mode);

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
          startDate,
          endDate,
          markPaid,
          userId: String(o?.userId || ""),
          orderId,
          mode,
        }),
      });

      const data = await res.json().catch(() => ({}));

      // normalize successful inflows (could be successful or successfulInflows)
      const successfulArr = Array.isArray(data?.successful)
        ? data.successful
        : Array.isArray(data?.successfulInflows)
        ? data.successfulInflows
        : [];

      // server-side totals if provided
      const paidTotalFromServer = toNum(data?.paidTotal ?? data?.updated?.paid ?? data?.updated?.paidTotal ?? 0);
      const outstandingFromServer = toNum(data?.updated?.outstanding ?? data?.updated?.outstandingAmount ?? 0);
      const updatedState = String(data?.updated?.state || data?.updated?.status || "").toLowerCase();

      if (data?.ok && successfulArr.length === 0) {
        toast.info("No successful inflow yet. Try again in 1–2 minutes.");
        return;
      }

      if (data?.ok && successfulArr.length > 0) {
        // sum incoming amounts from inflows (if server didn't provide a paidTotal)
        const incomingSum = successfulArr.reduce((s, inf) => {
          return s + toNum(inf?.amountNormalized ?? inf?.amount ?? 0);
        }, 0);

        // Helper to extract inflow references from an inflow
        const inflowRefFor = (inf) =>
          inf?.sessionId || inf?.transactionReference || inf?.paymentReference || inf?.payment_ref || "";

        patchOrderEverywhere(orderId, (prev) => {
          const next = { ...(prev || {}) };

          // Generic helper: merge processedRefs array into inflow record
          const mergeProcessedRefs = (existingInflowObj = {}, inflowsArr = []) => {
            const existingRefs = Array.isArray(existingInflowObj.processedRefs)
              ? [...existingInflowObj.processedRefs]
              : [];
            for (const inf of inflowsArr) {
              const r = inflowRefFor(inf);
              if (r && !existingRefs.includes(r)) existingRefs.push(r);
            }
            return { ...existingInflowObj, processedRefs: existingRefs };
          };

          // MODE: shipment
          if (mode === "shipment") {
            const prevPaid = toNum(next.shipmentPayment?.amountPaid);
            const prevInflow = (next.shipmentPayment?.payment?.inflow) || {};
            const processed = Array.isArray(prevInflow?.processedRefs) ? prevInflow.processedRefs.slice() : [];

            // add new processed refs
            const mergedInflow = mergeProcessedRefs(prevInflow, successfulArr);

            // Decide authoritative paid total:
            // prefer server paidTotal if present, else add incoming to prevPaid (but avoid double-applying known refs)
            let newPaid = prevPaid;
            if (paidTotalFromServer > 0) newPaid = Math.max(prevPaid, paidTotalFromServer);
            else {
              // sum incoming amounts only for inflows we haven't processed yet
              const newIncoming = successfulArr.reduce((s, inf) => {
                const r = inflowRefFor(inf);
                if (r && processed.includes(r)) return s; // already processed
                return s + toNum(inf?.amountNormalized ?? inf?.amount ?? 0);
              }, 0);
              newPaid = prevPaid + newIncoming;
            }

            newPaid = Math.max(0, newPaid);

            next.shipmentPayment = {
              ...(next.shipmentPayment || {}),
              enabled: true,
              state: updatedState || "partial",
              amountPaid: newPaid,
              outstanding:
                outstandingFromServer ||
                Math.max(0, toNum(next.shipmentPayment?.payment?.amount) - newPaid),
              payment: {
                ...(next.shipmentPayment?.payment || {}),
                state: updatedState || "partial",
                inflow: {
                  ...(next.shipmentPayment?.payment?.inflow || {}),
                  ...(successfulArr?.[0] || {}),
                  paidTotal: newPaid,
                  ...mergedInflow,
                },
              },
            };

            return next;
          }

          // MODE: balance (the one you reported)
          if (mode === "balance") {
            const prevPaid = toNum(next.balancePayment?.amountPaid);
            const prevInflow = (next.balancePayment?.payment?.inflow) || {};
            const processed = Array.isArray(prevInflow?.processedRefs) ? prevInflow.processedRefs.slice() : [];

            // Build merged processed refs
            const mergedInflow = mergeProcessedRefs(prevInflow, successfulArr);

            // If server sent a paidTotal, treat it authoritative (but ensure it's not less than existing prevPaid)
            let newPaid;
            if (paidTotalFromServer > 0) {
              newPaid = Math.max(prevPaid, paidTotalFromServer);
            } else {
              // Only add incoming amounts for inflows we haven't processed yet
              const newIncoming = successfulArr.reduce((s, inf) => {
                const r = inflowRefFor(inf);
                if (r && processed.includes(r)) return s; // already processed
                return s + toNum(inf?.amountNormalized ?? inf?.amount ?? 0);
              }, 0);
              newPaid = prevPaid + newIncoming;
            }

            newPaid = Math.max(0, newPaid);

            const balanceExpected = toNum(
              next.balancePayment?.payment?.amount ||
                next.balancePayment?.payableTotal ||
                next.balancePayment?.amount
            );
            const balanceOutstanding =
              outstandingFromServer || Math.max(0, balanceExpected - newPaid);
            const balanceState =
              updatedState ||
              (balanceExpected > 0 && newPaid >= balanceExpected ? "paid" : "partial");

            next.balancePayment = {
              ...(next.balancePayment || {}),
              enabled: true,
              state: balanceState,
              // ✅ accumulate (or use server total) rather than blindly overwrite
              amountPaid: newPaid,
              outstanding: balanceState === "paid" ? 0 : balanceOutstanding,
              paidAt:
                balanceState === "paid"
                  ? new Date().toISOString()
                  : next.balancePayment?.paidAt || null,
              payment: {
                ...(next.balancePayment?.payment || {}),
                state: balanceState,
                paidAt:
                  balanceState === "paid"
                    ? new Date().toISOString()
                    : next.balancePayment?.payment?.paidAt || null,
                inflow: {
                  ...(next.balancePayment?.payment?.inflow || {}),
                  ...(successfulArr?.[0] || {}),
                  expected: balanceExpected,
                  paidTotal: newPaid,
                  outstanding: balanceState === "paid" ? 0 : balanceOutstanding,
                  ...mergedInflow,
                },
              },
            };

            return next;
          }

          // MODE: order (main payment)
          {
            const prevPaid = toNum(next.payment?.amountPaid);
            const prevInflow = (next.payment?.inflow) || {};
            const processed = Array.isArray(prevInflow?.processedRefs) ? prevInflow.processedRefs.slice() : [];

            const mergedInflow = mergeProcessedRefs(prevInflow, successfulArr);

            let newPaid;
            if (paidTotalFromServer > 0) {
              newPaid = Math.max(prevPaid, paidTotalFromServer);
            } else {
              const newIncoming = successfulArr.reduce((s, inf) => {
                const r = inflowRefFor(inf);
                if (r && processed.includes(r)) return s;
                return s + toNum(inf?.amountNormalized ?? inf?.amount ?? 0);
              }, 0);
              newPaid = prevPaid + newIncoming;
            }

            newPaid = Math.max(0, newPaid);

            next.payment = {
              ...(next.payment || {}),
              inflow: {
                ...(next.payment?.inflow || {}),
                ...(successfulArr?.[0] || {}),
                paidTotal: newPaid,
                ...mergedInflow,
              },
              amountPaid: newPaid,
              outstanding:
                outstandingFromServer || Math.max(0, toNum(next.payment?.payableTotal || next.payableTotal || next.payment?.amount) - newPaid),
            };

            if (updatedState === "paid" || (next.payment && Number(next.payment.amountPaid || 0) >= Number(next.payment.payableTotal || next.payableTotal || 0))) {
              next.orderStatus = "Paid";
              next.payment = { ...(next.payment || {}), status: "Paid" };
            }

            return next;
          }
        });

        toast.success(
          updatedState === "paid"
            ? "Payment confirmed ✅ (Paid in full)"
            : "Payment confirmed ✅ (Partial)"
        );
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

  const TRACKING_LABEL = (o) =>
    String(o?.tracking?.stage || o?.trackingStage || "").trim() || "—";

  const updateTrackingStage = async (order, nextStage) => {
    const orderId = String(order?.id || "").trim();
    if (!orderId) return toast.error("Invalid order");
    if (!currentUser) return toast.error("Please sign in");
    if (!isAdmin) return toast.error("Only admin can update tracking");

    const currentStage = String(order?.tracking?.stage || order?.trackingStage || "").trim();
    const stage = String(nextStage || "").trim();

    if (!stage) return toast.error("Select a stage");
    if (!TRACKING_STAGES.includes(stage)) return toast.error("Invalid stage selected");
    if (stage === currentStage) return toast.info("Tracking stage is already set");

    try {
      setTrackById((p) => ({ ...p, [orderId]: true }));

      const effectiveOrderPath = getEffectiveOrderPath(order);
      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const feeSnapshot = getShipmentFee(order);

      await updateDoc(orderDocRef, {
        updatedAt: serverTimestamp(),
        trackingStage: stage,
        "tracking.stage": stage,
        "tracking.updatedAt": serverTimestamp(),
        "tracking.updatedBy": currentUser?.uid || null,
        "tracking.updatedByEmail": currentUser?.email || null,
        "tracking.history": arrayUnion({
          stage,
          at: new Date().toISOString(),
          by: currentUser?.uid || null,
          byEmail: currentUser?.email || null,
        }),
        "shipment.fee": Number(feeSnapshot || 0),
        "shipment.updatedAt": serverTimestamp(),
      });

      toast.success(`Tracking updated ✅ (${stage})`);

      patchOrderEverywhere(orderId, (prev) => ({
        ...prev,
        tracking: {
          ...(prev.tracking || {}),
          stage,
          updatedAt: new Date().toISOString(),
        },
        trackingStage: stage,
      }));
    } catch (e) {
      console.error("updateTrackingStage error:", e);

      try {
        const effectiveOrderPath = getEffectiveOrderPath(order);
        const orderDocRef = docRefFromPath(effectiveOrderPath);
        if (orderDocRef) {
          await setDoc(
            orderDocRef,
            {
              updatedAt: serverTimestamp(),
              trackingStage: stage,
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
            },
            { merge: true }
          );
          toast.success(`Tracking updated ✅ (${stage})`);
        } else {
          toast.error(e?.message || "Unable to update tracking");
        }
      } catch (e2) {
        toast.error(e2?.message || "Unable to update tracking");
      }
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

      const effectiveOrderPath = getEffectiveOrderPath(order);
      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const fee = Number(getShipmentFee(order) || 0);
      if (!fee || fee <= 0) {
        toast.error("No shipment fee found for this order");
        return;
      }

      await updateDoc(orderDocRef, {
        updatedAt: serverTimestamp(),
        "shipmentPayment.enabled": true,
        "shipmentPayment.amount": fee,
        "shipmentPayment.state": "unpaid",
        "shipmentPayment.enabledAt": serverTimestamp(),
        "shipmentPayment.enabledBy": currentUser?.uid || null,
      });

      toast.success("Shipment payment enabled ✅");

      patchOrderEverywhere(orderId, (prev) => ({
        ...prev,
        shipmentPayment: {
          ...(prev.shipmentPayment || {}),
          enabled: true,
          amount: fee,
          state: String(prev?.shipmentPayment?.state || "unpaid"),
        },
      }));
    } catch (e) {
      console.error("enableShipmentPayment error:", e);

      try {
        const effectiveOrderPath = getEffectiveOrderPath(order);
        const orderDocRef = docRefFromPath(effectiveOrderPath);
        const fee = Number(getShipmentFee(order) || 0);

        if (!orderDocRef) return toast.error("Order path invalid");
        if (!fee || fee <= 0) return toast.error("No shipment fee found for this order");

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
      } catch (e2) {
        toast.error(e2?.message || "Unable to enable shipment payment");
      }
    } finally {
      setTrackById((p) => ({ ...p, [`ship_${orderId}`]: false }));
    }
  };

  const saveShippingFeeUpdate = async () => {
    try {
      if (!selectedOrder?.id) return toast.error("Invalid order");
      if (!currentUser) return toast.error("Please sign in");
      if (!isAdmin) return toast.error("Only admin can update shipping fee");

      const orderId = String(selectedOrder.id || "").trim();
      const raw = String(shipFeeDraft || "").replace(/,/g, "").trim();
      const fee = Number(raw);

      if (!Number.isFinite(fee) || fee < 0) return toast.error("Enter a valid shipping fee");

      const currentFee = Number(getShipmentFee(selectedOrder) || 0);
      if (fee === currentFee) return toast.info("No shipping fee change detected");

      setShipFeeSaving(true);

      const effectiveOrderPath = getEffectiveOrderPath(selectedOrder);
      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      const itemsSubtotal = Number(selectedOrder?.totalAmount ?? 0) || 0;
      const base = itemsSubtotal + fee;

      const rate = getVatRate(selectedOrder);
      const existingVat =
        Number(selectedOrder?.vat?.amount ?? selectedOrder?.payment?.rawPayload?.vatAmount ?? 0) || 0;
      const vatAmount = rate > 0 ? Math.round(base * rate) : existingVat;
      const payableTotal = base + (Number(vatAmount) || 0);

      const shipState = String(
        selectedOrder?.shipmentPayment?.state || selectedOrder?.shipmentPayment?.payment?.state || ""
      ).toLowerCase();
      const shipIsPaid = shipState === "paid";
      const shipEnabled = !!selectedOrder?.shipmentPayment?.enabled;

      const nextShipmentPayment =
        shipEnabled && !shipIsPaid
          ? { ...(selectedOrder.shipmentPayment || {}), amount: fee }
          : null;

      const patch = {
        updatedAt: serverTimestamp(),
        shipmentFee: fee,
        "shipment.fee": fee,
        "shipment.updatedAt": serverTimestamp(),
        grandTotal: base,
        payableTotal: payableTotal,
        "vat.amount": Number(vatAmount) || 0,
        "payment.payableTotal": payableTotal,
        "payment.rawPayload.payableTotal": payableTotal,
        "payment.rawPayload.vatAmount": Number(vatAmount) || 0,
      };

      if (nextShipmentPayment) {
        patch["shipmentPayment.amount"] = fee;
      }

      await updateDoc(orderDocRef, patch);

      patchOrderEverywhere(orderId, (prev) => ({
        ...prev,
        shipmentFee: fee,
        shipment: { ...(prev.shipment || {}), fee },
        grandTotal: base,
        payableTotal: payableTotal,
        vat: { ...(prev?.vat || {}), amount: Number(vatAmount) || 0 },
        payment: {
          ...(prev?.payment || {}),
          payableTotal: payableTotal,
          rawPayload: {
            ...(prev?.payment?.rawPayload || {}),
            payableTotal: payableTotal,
            vatAmount: Number(vatAmount) || 0,
          },
        },
        ...(nextShipmentPayment ? { shipmentPayment: nextShipmentPayment } : {}),
      }));

      toast.success("Shipping fee updated ✅");
    } catch (e) {
      console.error("saveShippingFeeUpdate error:", e);
      toast.error(e?.message || "Unable to update shipping fee");
    } finally {
      setShipFeeSaving(false);
    }
  };


  const getManualRepairSectionInfo = (order = {}, mode = "order") => {
    const m = String(mode || "order").trim().toLowerCase();

    if (m === "balance") {
      const expected =
        toNum(order?.balancePayment?.payment?.amount) ||
        toNum(order?.balancePayment?.payableTotal) ||
        toNum(order?.balancePayment?.amount) ||
        0;

      const paidTotal =
        toNum(order?.balancePayment?.amountPaid) ||
        toNum(order?.balancePayment?.payment?.amountPaid) ||
        toNum(order?.balancePayment?.payment?.inflow?.paidTotal) ||
        toNum(order?.balancePayment?.payment?.inflow?.amount) ||
        toNum(order?.balancePayment?.payment?.inflow?.amountPaid) ||
        toNum(order?.balancePayment?.payment?.inflow?.["amount paid"]) ||
        0;

      return {
        mode: "balance",
        label: "Balance Payment",
        expected,
        paidTotal,
        outstanding: Math.max(0, expected - paidTotal),
        state: String(order?.balancePayment?.state || order?.balancePayment?.payment?.state || "").toLowerCase(),
        paymentReference:
          order?.balancePayment?.payment?.reference ||
          order?.balancePayment?.payment?.paymentRef ||
          order?.balancePayment?.reference ||
          "",
        customerReference: order?.balancePayment?.payment?.customerReference || "",
      };
    }

    if (m === "shipment") {
      const expected =
        toNum(order?.shipmentPayment?.payment?.amount) ||
        toNum(order?.shipmentPayment?.amount) ||
        toNum(order?.shipmentFee) ||
        toNum(getShipmentFee(order)) ||
        0;

      const paidTotal =
        toNum(order?.shipmentPayment?.amountPaid) ||
        toNum(order?.shipmentPayment?.payment?.amountPaid) ||
        toNum(order?.shipmentPayment?.payment?.inflow?.paidTotal) ||
        toNum(order?.shipmentPayment?.payment?.inflow?.amount) ||
        toNum(order?.shipmentPayment?.payment?.inflow?.amountPaid) ||
        toNum(order?.shipmentPayment?.payment?.inflow?.["amount paid"]) ||
        0;

      return {
        mode: "shipment",
        label: "Shipment Payment",
        expected,
        paidTotal,
        outstanding: Math.max(0, expected - paidTotal),
        state: String(order?.shipmentPayment?.state || order?.shipmentPayment?.payment?.state || "").toLowerCase(),
        paymentReference:
          order?.shipmentPayment?.payment?.reference ||
          order?.shipmentPayment?.payment?.paymentRef ||
          order?.shipmentPayment?.reference ||
          "",
        customerReference: order?.shipmentPayment?.payment?.customerReference || "",
      };
    }

    const expected =
      toNum(order?.payment?.amount) ||
      toNum(order?.payment?.payableTotal) ||
      toNum(order?.payableTotal) ||
      0;

    const paidTotal =
      toNum(order?.payment?.amountPaid) ||
      toNum(order?.payment?.inflow?.paidTotal) ||
      toNum(order?.payment?.inflow?.amountNormalized) ||
      toNum(order?.payment?.inflow?.amount) ||
      toNum(order?.payment?.inflow?.amountPaid) ||
      toNum(order?.payment?.inflow?.["amount paid"]) ||
      0;

    return {
      mode: "order",
      label: "Order Payment",
      expected,
      paidTotal,
      outstanding: Math.max(0, expected - paidTotal),
      state: String(order?.payment?.status || order?.payment?.state || order?.orderStatus || "").toLowerCase(),
      paymentReference: order?.payment?.reference || order?.payment?.paymentRef || order?.id || "",
      customerReference: order?.payment?.customerReference || "",
    };
  };

  const fillManualRepairDraft = (order = {}, mode = manualRepairMode) => {
    const info = getManualRepairSectionInfo(order, mode);
    const expected = Number(info.expected || 0);
    const paidTotal = Number(info.paidTotal || 0);

    setManualRepairMode(info.mode);
    setManualRepairExpected(expected ? String(expected) : "");
    setManualRepairAmount(paidTotal ? String(paidTotal) : "");
    setManualRepairStatus(expected > 0 && paidTotal >= expected ? "paid" : "partial");
    setManualRepairPaymentReference(String(info.paymentReference || ""));
    setManualRepairCustomerReference(String(info.customerReference || ""));
  };

  const openManualPaymentRepair = (order = {}) => {
    setSelectedOrder(order);
    setStageDraft(String(order?.tracking?.stage || order?.trackingStage || "").trim());
    setShipFeeDraft(String(getShipmentFee(order) || ""));
    fillManualRepairDraft(order, "order");
  };

  const saveManualPaymentRepair = async () => {
    if (!currentUser) return toast.error("Please sign in");
    if (!canRepairPaymentFields) return toast.error("You are not allowed to repair payment fields");
    if (!selectedOrder?.id) return toast.error("Select an order first");

    const orderId = String(selectedOrder.id || "").trim();
    const mode = String(manualRepairMode || "order").trim().toLowerCase();
    const statusChoice = String(manualRepairStatus || "partial").trim().toLowerCase();
    const expected = toNum(manualRepairExpected);
    const amountPaid = toNum(manualRepairAmount);

    if (!expected || expected <= 0) return toast.error("Enter the expected/payable amount");
    if (!amountPaid || amountPaid <= 0) return toast.error("Enter the amount paid");
    if (!["partial", "paid"].includes(statusChoice)) return toast.error("Select Partial or Paid");
    if (statusChoice === "paid" && amountPaid < expected) {
      return toast.error("Paid status requires amount paid to be equal to or above expected amount");
    }
    if (statusChoice === "partial" && amountPaid >= expected) {
      return toast.error("Amount paid reaches expected amount. Use Paid instead of Partial.");
    }

    try {
      setManualRepairSaving(true);

      const effectiveOrderPath = getEffectiveOrderPath(selectedOrder);
      const orderDocRef = docRefFromPath(effectiveOrderPath);
      if (!orderDocRef) return toast.error("Order path invalid");

      let freshOrder = selectedOrder;
      try {
        const freshSnap = await getDoc(orderDocRef);
        if (freshSnap.exists()) {
          freshOrder = {
            id: orderId,
            ...freshSnap.data(),
            orderPath: effectiveOrderPath,
          };
        }
      } catch (e) {
        console.warn("Could not fetch fresh order before manual repair:", e?.message || e);
      }

      const outstanding = statusChoice === "paid" ? 0 : Math.max(0, expected - amountPaid);
      const nextState = statusChoice === "paid" ? "paid" : "partial";
      const nextStatus = statusChoice === "paid" ? "Paid" : "partial";
      const nextOrderStatus = statusChoice === "paid" ? "Paid" : "Pending";
      const nowIso = new Date().toISOString();
      const paymentReference = String(manualRepairPaymentReference || "").trim();
      const customerReference = String(manualRepairCustomerReference || "").trim();

      const inflowPayload = {
        amount: amountPaid,
        "amount paid": amountPaid,
        amountPaid,
        customerReference,
        expected,
        outstanding,
        paidTotal: amountPaid,
        paymentReference,
        successfulCount: 1,
        updatedAt: nowIso,
        source: "manual_payment_field_repair",
        repairedBy: currentUser?.uid || null,
        repairedByEmail: currentUser?.email || null,
      };

      const repairLog = {
        at: nowIso,
        mode,
        section: mode,
        expected,
        paidTotal: amountPaid,
        outstanding,
        state: nextState,
        status: nextStatus,
        orderStatus: nextOrderStatus,
        paymentReference: paymentReference || null,
        customerReference: customerReference || null,
        reason: "Manual repair for old flipped payment row: restored missing inflow and status fields.",
        by: currentUser?.uid || null,
        byEmail: currentUser?.email || null,
      };

      const patch = {
        updatedAt: serverTimestamp(),
        paymentLogs: arrayUnion(repairLog),
        manualPaymentRepair: {
          lastRepairedAt: serverTimestamp(),
          lastRepairedBy: currentUser?.uid || null,
          lastRepairedByEmail: currentUser?.email || null,
          lastRepairedMode: mode,
          lastRepairedState: nextState,
          lastRepairedAmount: amountPaid,
        },
      };

      if (mode === "balance") {
        patch.balancePayment = {
          ...(freshOrder?.balancePayment || {}),
          enabled: true,
          state: nextState,
          amountPaid,
          outstanding,
          paidAt: nextState === "paid" ? serverTimestamp() : freshOrder?.balancePayment?.paidAt || null,
          payment: {
            ...(freshOrder?.balancePayment?.payment || {}),
            state: nextState,
            paidAt:
              nextState === "paid"
                ? serverTimestamp()
                : freshOrder?.balancePayment?.payment?.paidAt || null,
            inflow: {
              ...(freshOrder?.balancePayment?.payment?.inflow || {}),
              ...inflowPayload,
            },
          },
        };
      } else if (mode === "shipment") {
        patch.shipmentPayment = {
          ...(freshOrder?.shipmentPayment || {}),
          enabled: true,
          state: nextState,
          amountPaid,
          outstanding,
          paidAt: nextState === "paid" ? serverTimestamp() : freshOrder?.shipmentPayment?.paidAt || null,
          payment: {
            ...(freshOrder?.shipmentPayment?.payment || {}),
            state: nextState,
            paidAt:
              nextState === "paid"
                ? serverTimestamp()
                : freshOrder?.shipmentPayment?.payment?.paidAt || null,
            inflow: {
              ...(freshOrder?.shipmentPayment?.payment?.inflow || {}),
              ...inflowPayload,
            },
          },
        };
      } else {
        patch.orderStatus = nextOrderStatus;
        patch.payment = {
          ...(freshOrder?.payment || {}),
          status: nextStatus,
          state: nextState,
          paidAt: nextState === "paid" ? serverTimestamp() : freshOrder?.payment?.paidAt || null,
          amountPaid,
          outstanding,
          inflow: {
            ...(freshOrder?.payment?.inflow || {}),
            ...inflowPayload,
          },
        };
      }

      await setDoc(orderDocRef, patch, { merge: true });

      patchOrderEverywhere(orderId, (prev) => {
        const localInflow = {
          ...inflowPayload,
          updatedAt: nowIso,
        };

        if (mode === "balance") {
          return {
            ...prev,
            updatedAt: nowIso,
            balancePayment: {
              ...(prev?.balancePayment || {}),
              enabled: true,
              state: nextState,
              amountPaid,
              outstanding,
              paidAt: nextState === "paid" ? nowIso : prev?.balancePayment?.paidAt || null,
              payment: {
                ...(prev?.balancePayment?.payment || {}),
                state: nextState,
                paidAt:
                  nextState === "paid"
                    ? nowIso
                    : prev?.balancePayment?.payment?.paidAt || null,
                inflow: {
                  ...(prev?.balancePayment?.payment?.inflow || {}),
                  ...localInflow,
                },
              },
            },
          };
        }

        if (mode === "shipment") {
          return {
            ...prev,
            updatedAt: nowIso,
            shipmentPayment: {
              ...(prev?.shipmentPayment || {}),
              enabled: true,
              state: nextState,
              amountPaid,
              outstanding,
              paidAt: nextState === "paid" ? nowIso : prev?.shipmentPayment?.paidAt || null,
              payment: {
                ...(prev?.shipmentPayment?.payment || {}),
                state: nextState,
                paidAt:
                  nextState === "paid"
                    ? nowIso
                    : prev?.shipmentPayment?.payment?.paidAt || null,
                inflow: {
                  ...(prev?.shipmentPayment?.payment?.inflow || {}),
                  ...localInflow,
                },
              },
            },
          };
        }

        return {
          ...prev,
          updatedAt: nowIso,
          orderStatus: nextOrderStatus,
          payment: {
            ...(prev?.payment || {}),
            status: nextStatus,
            state: nextState,
            paidAt: nextState === "paid" ? nowIso : prev?.payment?.paidAt || null,
            amountPaid,
            outstanding,
            inflow: {
              ...(prev?.payment?.inflow || {}),
              ...localInflow,
            },
          },
        };
      });

      if (typeof refreshAdminOrders === "function") {
        try {
          refreshAdminOrders();
        } catch (e) {
          console.warn("refreshAdminOrders after manual repair failed:", e?.message || e);
        }
      }

      toast.success(`Payment fields restored as ${nextStatus} ✅`);
    } catch (e) {
      console.error("saveManualPaymentRepair error:", e);
      toast.error(e?.message || "Unable to repair payment fields");
    } finally {
      setManualRepairSaving(false);
    }
  };

  const goPayShipmentFee = (order) => {
    if (!currentUser) return toast.error("Please sign in");

    const fee = Number(getShipmentFee(order) || 0);
    if (!fee || fee <= 0) return toast.error("No shipment fee to pay");

    const orderId = String(order?.id || "").trim();
    const orderPath = getEffectiveOrderPath(order);

    closeEverything();

    setTimeout(() => {
      const url = `/checkout?mode=shipment&orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(
        String(fee)
      )}`;

      const payload = {
        mode: "shipment",
        paymentType: "shipment",
        orderId,
        orderPath,
        amount: fee,
        total: fee,
        totalAmount: fee,
        shipmentFee: fee,
        label: "Shipment Fee",
        items: [{ name: "Shipment Fee", price: fee, quantity: 1, total: fee }],
      };

      hardGoCheckout(url, payload);
    }, 50);
  };

  const goPayBalance = (order) => {
    if (!currentUser) return toast.error("Please sign in");

    const pi = getOrderPaidInfo(order);
    const balance = Number(pi.balance || 0);

    if (!balance || balance <= 0) return toast.error("No outstanding balance");

    const orderId = String(order?.id || "").trim();
    const orderPath = getEffectiveOrderPath(order);

    closeEverything();

    setTimeout(() => {
      const url = `/checkout?mode=balance&orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(
        String(balance)
      )}`;

      const payload = {
        mode: "balance",
        paymentType: "balance",
        orderId,
        orderPath,
        amount: balance,
        total: balance,
        totalAmount: balance,
        label: "Order Balance",
        items: [{ name: "Order Balance", price: balance, quantity: 1, total: balance }],
        meta: {
          payableTotal: Number(pi.payableAmount || 0),
          paidAmount: Number(pi.paidAmount || 0),
        },
      };

      hardGoCheckout(url, payload);
    }, 50);
  };

  const payBalanceInfo = useMemo(() => {
    if (!selectedOrder) return { canPay: false, balance: 0 };
    const pi = getOrderPaidInfo(selectedOrder);
    const bal = Number(pi.balance || 0);
    return { canPay: bal > 0, balance: bal };
  }, [selectedOrder]);

  return (
    <div className="p-6 bg-white rounded-2xl shadow-lg w-full max-w-6xl mx-auto mb-24">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{isAdmin ? "All Orders / Sales" : "My Orders"}</h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrintAllOrders}
            className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
          >
            🖨️ Print Orders
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end mb-6">
        <div className="flex flex-col">
          <label className="text-sm font-semibold mb-1">Search Name / Order / Product</label>
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="Search customer, phone, email, order ID, product name, SKU..."
            className="border rounded px-3 py-2 min-w-[280px]"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-semibold mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border rounded px-3 py-2"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-sm font-semibold mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border rounded px-3 py-2"
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setFromDate("");
            setToDate("");
            setSearchKeyword("");
          }}
          className="bg-gray-200 px-4 py-2 rounded text-sm"
        >
          Clear Filter
        </button>
      </div>

      <div ref={printAllRef}>
        <div className="overflow-x-auto border rounded-xl">
          <table className="min-w-[2150px] w-full">
            <thead className="bg-purple-700 text-white">
              <tr>
                <th className="p-3">SN</th>
                <th className="p-3">Order ID</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Items</th>
                <th className="p-3">Qty</th>
                <th className="p-3">Payable Amt (₦)</th>
                <th className="p-3">Paid Amt (Sum) (₦)</th>
                <th className="p-3">Balance (₦)</th>
                <th className="p-3">Payment</th>
                <th className="p-3">Paid Into (VA)</th>
                <th className="p-3">Shipment State</th>
                <th className="p-3">Shipment Outstanding</th>
                <th className="p-3">Balance State</th>
                <th className="p-3">Balance Outstanding</th>
                <th className="p-3">Tracking</th>
                <th className="p-3">Date</th>
                <th className="p-3 no-print">Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredOrders.map((order, index) => {
                const paymentInfo = getOrderPaidInfo(order);
                const isPaid = paymentInfo.isMarkedPaid;
                const orderQty = getOrderQuantityForSearch(order, searchKeyword);
                const pendingNoCommitment = isPendingWithoutPaymentCommitment(order);

                const customerName = order.customer?.name || order.userName || "Guest";
                const reconLoading = !!reconById[order.id];
                const paidInto = getVaNubanFromOrder(order);
                const { date, time } = safeFormatDateTime(order.createdAt);
                const trackingStage = TRACKING_LABEL(order);

                const shipInfo = getShipmentPaidInfo(order);
                const balInfo = getBalancePaidInfo(order);

                const payBadge = paymentInfo.isUnderpaid
                  ? "Underpaid"
                  : order.payment?.status || order.orderStatus || "Pending";

                return (
                  <tr
                    key={order.id}
                    className={`border-b ${
                      pendingNoCommitment
                        ? "bg-gray-100 text-gray-500 opacity-70"
                        : "hover:bg-gray-50"
                    }`}
                    title={
                      pendingNoCommitment
                        ? "Pending order with no payment commitment yet"
                        : undefined
                    }
                  >
                    <td className="p-3">{index + 1}</td>
                    <td className="p-3">{order.id?.slice(0, 8)}...</td>
                    <td className="p-3">{customerName}</td>

                    <td className="p-3">
                      {order.cart?.map((i) => getItemDisplayName(i)).join(", ") || "—"}
                    </td>

                    <td className="p-3 font-bold text-center">{orderQty}</td>

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
                              : isPaid
                              ? "bg-green-100 text-green-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {pendingNoCommitment ? "Pending — No Commitment" : payBadge}
                        </span>

                        <button
                          type="button"
                          onClick={() => confirmPaymentForOrder(order)}
                          disabled={reconLoading}
                          className={`${
                            reconLoading ? "bg-gray-400" : "bg-green-700 hover:bg-green-800"
                          } text-white px-3 py-2 rounded text-xs font-semibold transition w-fit`}
                          title={
                            isAdmin
                              ? "Admin can confirm and mark Paid/Partial"
                              : "Checks inflow and updates UI"
                          }
                        >
                          {reconLoading
                            ? "Checking..."
                            : isAdmin
                            ? "Confirm payment (Admin)"
                            : "I have paid (Confirm)"}
                        </button>
                      </div>
                    </td>

                    <td className="p-3 font-mono">{maskNuban(paidInto)}</td>

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
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          balInfo.isPaid
                            ? "bg-green-100 text-green-700"
                            : balInfo.isPartial
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {balInfo.isPaid ? "Paid" : balInfo.isPartial ? "Partial" : "—"}
                      </span>
                    </td>

                    <td className="p-3 font-semibold">
                      ₦{Number(balInfo.outstanding || 0).toLocaleString()}
                    </td>

                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
                        {trackingStage}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="leading-tight">
                        <div>{date}</div>
                        {time ? <div className="text-xs italic text-gray-600">{time}</div> : null}
                      </div>
                    </td>

                    <td className="p-3 text-center no-print">
                      <div className="flex flex-col gap-2 items-center">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrder(order);
                              setStageDraft(
                                String(order?.tracking?.stage || order?.trackingStage || "").trim()
                              );
                              setShipFeeDraft(String(getShipmentFee(order) || ""));
                              fillManualRepairDraft(order, "order");
                            }}
                            className="bg-purple-700 hover:bg-purple-800 text-white px-3 py-1 rounded text-xs"
                          >
                            Tracking / Stage
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrder(order);
                              setStageDraft("");
                              setShipFeeDraft("");
                              fillManualRepairDraft(order, "order");
                            }}
                            className="bg-black text-white px-3 py-1 rounded text-xs font-semibold"
                          >
                            View Receipt
                          </button>
                        )}

                        {canRepairPaymentFields ? (
                          <button
                            type="button"
                            onClick={() => openManualPaymentRepair(order)}
                            className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-xs font-semibold"
                            title="Restore old flipped paid/partial payment fields"
                          >
                            Repair Payment
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredOrders.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan={17}>
                    No orders found for the selected search/date filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-4">
            <div>Total Orders: {filteredOrders.length}</div>
            <div>Total Qty: {Number(totals.totalQuantity || 0).toLocaleString()}</div>
            <div>Pending / No Commitment: {Number(totals.pendingWithoutCommitment || 0).toLocaleString()}</div>
            <div>Total Payable: ₦{totals.totalRevenue.toLocaleString()}</div>
            <div>Total Paid (Sum): ₦{totals.paidRevenue.toLocaleString()}</div>
            <div>Total Balance: ₦{totals.totalOutstanding.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50">
          <div className="min-h-screen w-full flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white w-full max-w-md rounded-lg relative shadow-lg max-h-[85vh] flex flex-col">
              <div className="sticky top-0 bg-white z-10 border-b px-6 py-4 rounded-t-lg flex items-center justify-between">
                <div className="font-bold text-gray-800">
                  {isAdmin ? "Tracking / Stage" : "Receipt"}
                </div>
                <button
                  type="button"
                  className="text-purple-700 hover:text-purple-900"
                  onClick={() => {
                    setSelectedOrder(null);
                    setStageDraft("");
                    setShipFeeDraft("");
                  }}
                  aria-label="Close"
                >
                  <IoClose size={24} />
                </button>
              </div>

              <div className="px-6 py-4 overflow-y-auto">
                <div ref={printRef} style={{ textAlign: "center" }}>
                  <h3>CHAREX</h3>
                  <p style={{ fontSize: "11px", fontStyle: "italic" }}>
                    Shop Smart. Save More. Smile More.
                  </p>
                  <p>+234 706 405 8684</p>
                  <p> PreorderwithCharex@gmail.com</p>
                  <p>No. 44B Lumac Street, Satellite Town, Lagos</p>

                  <hr />

                  <h3>ORDER RECEIPT</h3>

                  <hr />

                  <div style={{ textAlign: "left" }}>
                    <p>
                      <b>Order ID:</b> {selectedOrder.id?.slice(0, 10)}
                    </p>

                    <p>
                      <b>Date:</b>{" "}
                      {selectedOrder.createdAt?.toDate
                        ? selectedOrder.createdAt.toDate().toLocaleDateString()
                        : safeFormatDate(selectedOrder.createdAt)}
                      <br />
                      <span style={{ fontSize: "11px", fontStyle: "italic" }}>
                        {selectedOrder.createdAt?.toDate
                          ? selectedOrder.createdAt
                              .toDate()
                              .toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                          : safeFormatTime(selectedOrder.createdAt)}
                      </span>
                    </p>

                    <p>
                      <b>Customer:</b>{" "}
                      {selectedOrder.customer?.name || selectedOrder.userName || "Guest"}
                    </p>
                    <p>
                      <b>Phone:</b>{" "}
                      {selectedOrder.customer?.phone ||
                        selectedOrder.shippingAddress?.phone ||
                        "N/A"}
                    </p>

                    <p>
                      <b>Email:</b>{" "}
                      {selectedOrder.customer?.email ||
                        selectedOrder.userEmail ||
                        selectedOrder.shippingAddress?.email ||
                        "N/A"}
                    </p>
                    <p>
                      <b>Address:</b>{" "}
                      {selectedOrder.customer?.address ||
                        selectedOrder.shippingAddress?.fullAddress ||
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
                      <b>Paid Into (VA):</b> {maskNuban(getVaNubanFromOrder(selectedOrder))}
                    </p>

                    <p>
                      <b>Tracking:</b> {TRACKING_LABEL(selectedOrder)}
                    </p>

                    {(() => {
                      const ship = getShipmentPaidInfo(selectedOrder);
                      return (
                        <p>
                          <b>Shipment:</b>{" "}
                          {ship.isPaid ? "Paid" : ship.isPartial ? "Partial" : "Not Paid"}{" "}
                          {ship.expected ? `— Expected ₦${Number(ship.expected).toLocaleString()}` : ""}{" "}
                          {ship.paidTotal ? `— Paid ₦${Number(ship.paidTotal).toLocaleString()}` : ""}{" "}
                          {ship.outstanding
                            ? `— Outstanding ₦${Number(ship.outstanding).toLocaleString()}`
                            : ""}
                        </p>
                      );
                    })()}

                    {(() => {
                      const bal = getBalancePaidInfo(selectedOrder);
                      const show = (bal.expected || bal.paidTotal || bal.outstanding) > 0;
                      if (!show) return null;
                      return (
                        <p>
                          <b>Balance Payment:</b>{" "}
                          {bal.isPaid ? "Paid" : bal.isPartial ? "Partial" : "Pending"}{" "}
                        </p>
                      );
                    })()}

                    {(() => {
                      const pi = getOrderPaidInfo(selectedOrder);
                      return (
                        <>
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
                        </>
                      );
                    })()}
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
                    <span>₦{(Number(selectedOrder.totalAmount) || 0).toLocaleString()}</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                    <span>Delivery / Shipment Fee</span>
                    <span>₦{Number(getShipmentFee(selectedOrder) || 0).toLocaleString()}</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                    <span>Base Total</span>
                    <span>₦{Number(getBaseBeforeVat(selectedOrder) || 0).toLocaleString()}</span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
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

                  {(() => {
                    const pi = getOrderPaidInfo(selectedOrder);
                    return (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
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
                      </>
                    );
                  })()}

                  <hr />

                  <p>Thank you for shopping with CHAREX.</p>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleThermalPrint}
                    className="bg-black text-white w-full py-2 rounded"
                  >
                    🖨️ Print Receipt
                  </button>

                  <button
                    type="button"
                    onClick={() => goPayBalance(selectedOrder)}
                    disabled={!payBalanceInfo.canPay}
                    className={`bg-black text-white w-full py-2 rounded font-semibold transition
                      ${payBalanceInfo.canPay ? "hover:bg-gray-900" : "opacity-50 cursor-not-allowed"}
                    `}
                    title={
                      payBalanceInfo.canPay
                        ? "Complete your payment by paying the remaining balance"
                        : "No outstanding balance"
                    }
                  >
                    Pay Balance{" "}
                    {payBalanceInfo.balance > 0
                      ? `— ₦${payBalanceInfo.balance.toLocaleString()}`
                      : ""}
                  </button>
                </div>


                {canRepairPaymentFields ? (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-bold text-gray-800 mb-2">
                      Manual Payment Field Repair
                    </h4>

                    <div className="text-xs text-gray-600 mb-3">
                      Use this only for old orders that previously had paid/partial inflow but flipped back to pending and lost the inflow map.
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Payment Section</label>
                        <select
                          value={manualRepairMode}
                          onChange={(e) => {
                            const nextMode = e.target.value;
                            setManualRepairMode(nextMode);
                            fillManualRepairDraft(selectedOrder, nextMode);
                          }}
                          className="border rounded px-3 py-2 w-full"
                        >
                          <option value="order">Order Payment</option>
                          <option value="balance">Balance Payment</option>
                          <option value="shipment">Shipment Payment</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-gray-700">Restore Status</label>
                        <select
                          value={manualRepairStatus}
                          onChange={(e) => setManualRepairStatus(e.target.value)}
                          className="border rounded px-3 py-2 w-full"
                        >
                          <option value="partial">Partial</option>
                          <option value="paid">Paid</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Expected Amount</label>
                          <input
                            value={manualRepairExpected}
                            onChange={(e) => setManualRepairExpected(e.target.value)}
                            inputMode="numeric"
                            placeholder="e.g. 40160"
                            className="border rounded px-3 py-2 w-full"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-gray-700">Amount Paid</label>
                          <input
                            value={manualRepairAmount}
                            onChange={(e) => setManualRepairAmount(e.target.value)}
                            inputMode="numeric"
                            placeholder="e.g. 10000"
                            className="border rounded px-3 py-2 w-full"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-gray-700">Payment Reference</label>
                        <input
                          value={manualRepairPaymentReference}
                          onChange={(e) => setManualRepairPaymentReference(e.target.value)}
                          placeholder="Provider payment reference, if available"
                          className="border rounded px-3 py-2 w-full"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-gray-700">Customer Reference</label>
                        <input
                          value={manualRepairCustomerReference}
                          onChange={(e) => setManualRepairCustomerReference(e.target.value)}
                          placeholder="Customer/order reference, if available"
                          className="border rounded px-3 py-2 w-full"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={saveManualPaymentRepair}
                        disabled={manualRepairSaving}
                        className={`w-full py-2 rounded text-white font-semibold ${
                          manualRepairSaving ? "bg-gray-400" : "bg-amber-700 hover:bg-amber-800"
                        }`}
                      >
                        {manualRepairSaving ? "Saving Repair..." : "Restore Missing Payment Fields"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {(() => {
                  const fee = Number(getShipmentFee(selectedOrder) || 0);

                  const enabled = !!selectedOrder?.shipmentPayment?.enabled;

                  const shipState = String(
                    selectedOrder?.shipmentPayment?.state ||
                      selectedOrder?.shipmentPayment?.payment?.state ||
                      ""
                  ).toLowerCase();
                  const isShipPaid = shipState === "paid";

                  const stage = String(
                    selectedOrder?.tracking?.stage || selectedOrder?.trackingStage || ""
                  ).trim();
                  const stageMakesReady = stage === "Out for delivery";

                  const canPay = (enabled || stageMakesReady) && fee > 0 && !isShipPaid;

                  return (
                    <div className="mt-4 border-t pt-4">
                      <h4 className="font-bold text-gray-800 mb-2">Shipment Fee</h4>

                      <div className="text-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span>
                            Fee: <b>₦{fee.toLocaleString()}</b>
                          </span>
                          <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">
                            {isShipPaid
                              ? "paid"
                              : canPay
                              ? "payable"
                              : enabled
                              ? "enabled"
                              : "not enabled"}
                          </span>
                        </div>

                        {isAdmin ? (
                          <div className="mb-3 p-3 rounded border bg-gray-50">
                            <div className="font-semibold text-gray-800 mb-2">
                              Correct Delivery Fee (Admin)
                            </div>

                            <div className="flex gap-2">
                              <input
                                value={shipFeeDraft}
                                onChange={(e) => setShipFeeDraft(e.target.value)}
                                inputMode="numeric"
                                placeholder="e.g. 3000"
                                className="border rounded px-3 py-2 w-full"
                              />
                              <button
                                type="button"
                                onClick={saveShippingFeeUpdate}
                                disabled={shipFeeSaving}
                                className={`px-3 py-2 rounded text-white text-sm font-semibold ${
                                  shipFeeSaving ? "bg-gray-400" : "bg-black hover:bg-gray-900"
                                }`}
                              >
                                {shipFeeSaving ? "Saving..." : "Save"}
                              </button>
                            </div>

                            <div className="text-xs text-gray-600 mt-2">
                              Updates delivery fee + recalculates totals (base/VAT/payable) and refreshes table instantly.
                            </div>
                          </div>
                        ) : null}

                        {isAdmin ? (
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
                          title={
                            canPay
                              ? "Proceed to pay shipment fee"
                              : fee <= 0
                              ? "No shipment fee found"
                              : isShipPaid
                              ? "Shipment fee already paid"
                              : "Shipment fee payment not enabled yet"
                          }
                        >
                          Pay Shipment Fee Now
                        </button>
                      </div>
                    </div>
                  );
                })()}

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
                        disabled={!!trackById[selectedOrder.id] || !stageDraft}
                        className={`px-3 py-2 rounded text-white text-sm font-semibold ${
                          !!trackById[selectedOrder.id] ? "bg-gray-400" : "bg-blue-700 hover:bg-blue-800"
                        }`}
                      >
                        {!!trackById[selectedOrder.id] ? "Saving..." : "Update"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="h-2" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersTable;