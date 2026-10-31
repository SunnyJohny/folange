
import React, { useEffect, useState } from "react";
import {
  FaHeart,
  FaShoppingCart,
  FaCheckCircle,
  FaClipboardList,
  FaListUl,
} from "react-icons/fa";
import { useMyContext } from "../Context/MyContext";
import OrdersTable from "./OrdersTable";
import { v4 as uuidv4 } from "uuid";

const BottomNav = () => {
  const {
    statusFilter,
    setStatusFilter,
    setFilterCategory,
    showOrdersModal,
    setShowOrdersModal,
    currentUser,
    isAdmin,
  } = useMyContext();

  const [activeTab, setActiveTab] = useState("all");

  const normalize = (value) =>
    (value || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  /*
   * Create and retain a visitor ID for this browser.
   */
  useEffect(() => {
    let storedVisitorId = localStorage.getItem("visitorId");

    if (!storedVisitorId) {
      storedVisitorId = uuidv4();
      localStorage.setItem("visitorId", storedVisitorId);
    }
  }, []);

  /*
   * Keep the highlighted navigation tab synchronized
   * with the actual statusFilter and Orders modal.
   */
  useEffect(() => {
    if (showOrdersModal) {
      setActiveTab("orders");
      return;
    }

    const normalizedFilter = normalize(statusFilter);

    if (normalizedFilter === "available") {
      setActiveTab("available");
    } else if (normalizedFilter === "preorder") {
      setActiveTab("preorder");
    } else if (normalizedFilter === "wishlist") {
      setActiveTab("wishlist");
    } else {
      setActiveTab("all");
    }
  }, [showOrdersModal, statusFilter]);

  /*
   * Scroll to the Folange product section.
   */
  const scrollToProducts = () => {
    const target = document.getElementById("cookingitems");

    if (!target) return;

    const offset = 80;
    const top =
      target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top,
      behavior: "smooth",
    });
  };

  /*
   * Apply product filters and clear any previous category filter.
   */
  const applyProductFilter = (filterValue) => {
    setShowOrdersModal(false);

    setFilterCategory("");
    setStatusFilter(filterValue);

    /*
     * Allow React to update the product list before scrolling.
     */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToProducts();
      });
    });
  };

  /*
   * Bottom navigation actions.
   */
  const handleTabClick = (tab) => {
    if (tab === "orders") {
      setActiveTab("orders");
      setShowOrdersModal(true);
      return;
    }

    if (tab === "available") {
      setActiveTab("available");
      applyProductFilter("Available");
      return;
    }

    if (tab === "preorder") {
      setActiveTab("preorder");
      applyProductFilter("Pre-Order");
      return;
    }

    if (tab === "wishlist") {
      setActiveTab("wishlist");
      applyProductFilter("Wishlist");
      return;
    }

    setActiveTab("all");
    applyProductFilter("All");
  };

  /*
   * Close the orders modal and restore the correct active tab.
   */
  const closeOrdersModal = () => {
    setShowOrdersModal(false);

    const normalizedFilter = normalize(statusFilter);

    if (normalizedFilter === "available") {
      setActiveTab("available");
    } else if (normalizedFilter === "preorder") {
      setActiveTab("preorder");
    } else if (normalizedFilter === "wishlist") {
      setActiveTab("wishlist");
    } else {
      setActiveTab("all");
    }
  };

  const tabs = [
    {
      id: "orders",
      label: isAdmin ? "Orders" : "My Orders",
      icon: FaClipboardList,
    },
    {
      id: "preorder",
      label: "Pre-Order",
      icon: FaShoppingCart,
    },
    {
      id: "available",
      label: "Available",
      icon: FaCheckCircle,
    },
    {
      id: "all",
      label: "All",
      icon: FaListUl,
    },
    {
      id: "wishlist",
      label: "Wishlist",
      icon: FaHeart,
    },
  ];

  return (
    <>
      {/* Fixed Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#E9DDC8] bg-[#FFFCF7] shadow-[0_-4px_18px_rgba(73,55,35,0.10)]">
        <div className="mx-auto flex w-full items-stretch justify-between">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => handleTabClick(id)}
                aria-label={label}
                aria-pressed={isActive}
                className={`group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 transition-all duration-200 ${
                  isActive
                    ? "bg-[#F3E9D7] text-[#8A6517]"
                    : "text-[#493723] hover:bg-[#F8F1E6] hover:text-[#8A6517]"
                }`}
              >
                {isActive && (
                  <span className="absolute left-1/2 top-0 h-1 w-10 -translate-x-1/2 rounded-b-full bg-[#D4AF37]" />
                )}

                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
                    isActive
                      ? "bg-[#8A6517] text-white shadow-md"
                      : "bg-transparent group-hover:bg-[#F3E9D7]"
                  }`}
                >
                  <Icon className="text-lg" />
                </span>

                <span
                  className={`max-w-full truncate text-[10px] font-semibold sm:text-xs ${
                    isActive ? "text-[#8A6517]" : "text-[#493723]"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Orders Modal */}
      {showOrdersModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-5"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeOrdersModal();
            }
          }}
        >
          <div className="relative max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#E9DDC8] bg-[#FFFCF7] shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#E9DDC8] bg-[#FFFCF7] px-4 py-4 sm:px-6">
              <div>
                <h2 className="text-xl font-extrabold text-[#493723] sm:text-2xl">
                  {isAdmin ? "FOLANGE Orders" : "My FOLANGE Orders"}
                </h2>

                <p className="mt-1 text-xs text-[#8A765B] sm:text-sm">
                  {currentUser
                    ? "View and manage your Folange order information."
                    : "Sign in to view your Folange orders."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeOrdersModal}
                aria-label="Close orders"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#F3E9D7] text-xl font-bold text-[#8A6517] transition-colors duration-200 hover:bg-[#8A6517] hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Orders Table */}
            <div className="p-2 sm:p-4">
              <OrdersTable />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BottomNav;
