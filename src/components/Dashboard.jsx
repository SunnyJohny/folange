import React, { useEffect, useState, useCallback } from "react";
import { useMyContext } from "../Context/MyContext";
import OrdersTable from "./OrdersTable";
import VisitorsTracker from "./visitorTracker";
import InventoryPage from "./InventoryPage";
import SalesPage from "./SalesPage";
import UsersPage from "./UsersPage";
import PaymentsPage from "./PaymentsPage";

import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useLocation } from "react-router-dom";

const Dashboard = () => {
  const { currentUser, orders } = useMyContext();
  const location = useLocation();

  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [showVisitorsModal, setShowVisitorsModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);

  const [totalVisitors, setTotalVisitors] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);

  const userName = currentUser?.name || "Guest User";
  const userRole = currentUser?.role || "Regular User";
  const userID = currentUser?.uid ? currentUser.uid.substring(0, 6) : "----";

  /* ---------------- FETCH NON-ORDER STATS ---------------- */
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const visitorsSnap = await getDocs(collection(db, "visitors"));
        setTotalVisitors(visitorsSnap.size);

        const productsSnap = await getDocs(collection(db, "dishes"));
        setTotalProducts(productsSnap.size);

        const usersSnap = await getDocs(collection(db, "users"));
        setTotalUsers(usersSnap.size);
      } catch (err) {
        console.error("Error fetching stats:", err);
      }
    };

    fetchStats();
  }, []);

  /* ---------------- ORDER-BASED CALCULATIONS ---------------- */

  // 🔹 Total sales (ALL orders, paid + pending)
  const totalSales = (orders || []).reduce(
    (sum, o) => sum + (Number(o.totalAmount) || 0),
    0
  );

  // ✅ Payments Received (ONLY PAID / SUCCESS)
  const totalPaymentsReceived = (orders || [])
    .filter((o) => o.payment?.status === "Paid" || o.payment?.status === "Success")
    .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

  // 🔹 Customer personal transactions
  const myTransactions = (orders || [])
    .filter((o) => o.userId === currentUser?.uid)
    .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

  /* ---------------- DASHBOARD CARDS ---------------- */

  const adminCards = [
    {
      title: "Total Products / Inventory",
      color: "border-t-[#D4AF37]",
      total: totalProducts,
      isInventory: true,
    },
    {
      title: "Orders / Sales",
      color: "border-t-[#8A6517]",
      total: (orders || []).length,
      isOrders: true,
    },
    {
      title: "Visitors",
      color: "border-t-[#7D7262]",
      total: totalVisitors,
      isVisitors: true,
    },
    {
      title: "Payments Received (₦)",
      color: "border-t-[#A78945]",
      total: totalPaymentsReceived,
      isPayments: true,
    },
    {
      title: "Users",
      color: "border-t-[#534735]",
      total: totalUsers,
      isUsers: true,
    },
  ];

  const customerCards = [
    {
      title: "My Orders",
      color: "border-t-[#D4AF37]",
      total: (orders || []).filter((o) => o.userId === currentUser?.uid).length,
      isOrders: true,
    },
    {
      title: "My Transactions (₦)",
      color: "border-t-[#8A6517]",
      total: myTransactions,
      isOrders: true,
    },
  ];

  // ✅ Close everything (memoized so effects can use it safely)
  const closeAllModals = useCallback(() => {
    setShowOrdersModal(false);
    setShowVisitorsModal(false);
    setShowInventoryModal(false);
    setShowSalesModal(false);
    setShowUsersModal(false);
    setShowPaymentsModal(false);

    try {
      document.body.style.overflow = "";
    } catch {}
  }, []);

  const isAnyModalOpen =
    showOrdersModal ||
    showVisitorsModal ||
    showInventoryModal ||
    showSalesModal ||
    showUsersModal ||
    showPaymentsModal;

  // ✅ LOCK BACKGROUND SCROLL WHEN ANY MODAL IS OPEN
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (isAnyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [isAnyModalOpen]);

  // ✅ IMPORTANT: Listen for the global event dispatched from OrdersTable
  // This lets OrdersTable close the Dashboard modal shell reliably.
  useEffect(() => {
    const handler = () => closeAllModals();
    window.addEventListener("close-all-dashboard-modals", handler);
    return () => window.removeEventListener("close-all-dashboard-modals", handler);
  }, [closeAllModals]);

  // ✅ Close all modals when route changes
  useEffect(() => {
    closeAllModals();
  }, [location.pathname, location.search, closeAllModals]);

  const handleCardClick = (card) => {
    // ✅ ensure only ONE modal opens
    closeAllModals();

    // ✅ open the selected modal next tick (avoids overlap/race on some browsers)
    setTimeout(() => {
      if (card.isOrders) setShowOrdersModal(true);
      else if (card.isVisitors) setShowVisitorsModal(true);
      else if (card.isInventory) setShowInventoryModal(true);
      else if (card.isSales) setShowSalesModal(true);
      else if (card.isUsers) setShowUsersModal(true);
      else if (card.isPayments) setShowPaymentsModal(true);
    }, 0);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FFFCF7] p-4 text-[#3F3528] sm:p-6 md:p-10">

      {/* ✅ When a card is selected, hide dashboard content */}
      {!isAnyModalOpen && (
        <div className="relative z-10">
          {/* DASHBOARD HEADING */}
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="/images/Folange%20Beauty%20Lounge%20logo.png"
              alt="Folange Beauty Lounge"
              className="mb-3 h-16 w-16 rounded-full object-contain"
            />
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
              Folange Beauty Lounge
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-[#3F3528]">Dashboard</h1>
            <p className="mt-2 text-sm text-[#7D7262]">Beauty · Wellness · Spa · Education</p>
          </div>

          {/* PROFILE */}
          <div className="relative mx-auto mb-8 w-full max-w-md overflow-hidden rounded-lg border border-[#E7D8B8] bg-white shadow-[0_12px_35px_rgba(99,76,34,0.09)]">
            <div className="h-2 bg-[#D4AF37]" />

            <div className="relative flex flex-col items-center px-6 py-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E7D8B8] bg-[#F3E9D7] text-2xl font-semibold text-[#8A6517]">
                {userName.charAt(0).toUpperCase()}
              </div>

              <div className="mt-4 text-center">
                <p className="mb-1 text-xl font-semibold text-[#3F3528]">
                  {userName}
                </p>

                <span className="inline-flex rounded-full bg-[#F3E9D7] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#8A6517]">
                  {userRole}
                </span>

                <p className="mt-3 text-sm text-[#7D7262]">
                  User ID: {userID}...
                </p>
              </div>
            </div>
          </div>

          {/* SUMMARY STRIP */}
          <div className="mx-auto mb-8 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#E7D8B8] bg-white p-4 text-center shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7D7262]">
                Total Sales
              </p>
              <p className="mt-1 text-xl font-semibold text-[#8A6517]">
                ₦{Number(totalSales || 0).toLocaleString()}
              </p>
            </div>

            <div className="rounded-lg border border-[#E7D8B8] bg-white p-4 text-center shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7D7262]">
                Payments Received
              </p>
              <p className="mt-1 text-xl font-semibold text-[#8A6517]">
                ₦{Number(totalPaymentsReceived || 0).toLocaleString()}
              </p>
            </div>

            <div className="rounded-lg border border-[#E7D8B8] bg-white p-4 text-center shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7D7262]">
                Active Role
              </p>
              <p className="mt-1 text-xl font-semibold capitalize text-[#3F3528]">
                {userRole}
              </p>
            </div>
          </div>

          {/* CARDS */}
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {(userRole === "admin" ? adminCards : customerCards).map((card) => (
              <div
                key={card.title}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(card)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleCardClick(card);
                }}
                className={`group relative min-h-[150px] cursor-pointer overflow-hidden rounded-lg border border-t-4 border-[#E7D8B8] ${card.color} bg-white p-5 text-[#3F3528] shadow-sm transition hover:-translate-y-1 hover:shadow-[0_12px_28px_rgba(99,76,34,0.12)] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]`}
              >
                <div className="relative z-10 flex h-full flex-col items-center justify-center text-center">
                  <p className="text-base font-semibold leading-snug sm:text-lg">
                    {card.title}
                  </p>

                  <div className="mt-4 h-px w-10 bg-[#D4AF37] transition-all duration-300 group-hover:w-16" />

                  <p className="mt-4 text-3xl font-semibold text-[#8A6517]">
                    {typeof card.total === "number"
                      ? card.title.includes("(₦)") || card.title.includes("Transactions")
                        ? `₦${Number(card.total || 0).toLocaleString()}`
                        : Number(card.total || 0).toLocaleString()
                      : card.total}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODALS */}
      {showOrdersModal && (
        <Modal close={() => setShowOrdersModal(false)} title="Orders / Sales">
          <OrdersTable onClose={() => setShowOrdersModal(false)} />
        </Modal>
      )}

      {showVisitorsModal && (
        <Modal close={() => setShowVisitorsModal(false)} title="Visitors">
          <VisitorsTracker />
        </Modal>
      )}

      {showInventoryModal && (
        <Modal close={() => setShowInventoryModal(false)} title="Inventory">
          <InventoryPage />
        </Modal>
      )}

      {showSalesModal && (
        <Modal close={() => setShowSalesModal(false)} title="Sales">
          <SalesPage />
        </Modal>
      )}

      {showUsersModal && (
        <Modal close={() => setShowUsersModal(false)} title="Users">
          <UsersPage />
        </Modal>
      )}

      {showPaymentsModal && (
        <Modal close={() => setShowPaymentsModal(false)} title="Payments">
          <PaymentsPage />
        </Modal>
      )}
    </div>
  );
};

/* ---------------- REUSABLE MODAL ---------------- */
const Modal = ({ close, children, title = "Folange Dashboard" }) => (
  <div
    className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#3F3528]/65 p-3 backdrop-blur-sm sm:p-5"
    onClick={close} // ✅ click outside closes
    role="presentation"
  >
    <div
      className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#E7D8B8] bg-[#FFFCF7] shadow-[0_25px_80px_rgba(63,53,40,0.3)] sm:w-11/12"
      onClick={(e) => e.stopPropagation()} // ✅ prevent inside clicks from closing
      role="presentation"
    >
      <div className="flex min-h-[72px] items-center justify-between border-b border-[#E7D8B8] bg-[#FFFCF7] px-5 pr-16 text-[#3F3528] sm:px-8">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
            Folange Beauty Lounge
          </p>

          <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
            {title}
          </h2>
        </div>
      </div>

      <button
        type="button"
        onClick={close}
        className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-[#E7D8B8] bg-white text-xl font-bold text-[#8A6517] transition-colors hover:bg-[#F3E9D7]"
        aria-label="Close dashboard modal"
      >
        ✕
      </button>

      <div className="flex-1 overflow-y-auto bg-[#FFFCF7] px-4 pb-6 pt-5 sm:px-6">
        {children}
      </div>
    </div>
  </div>
);

export default Dashboard;