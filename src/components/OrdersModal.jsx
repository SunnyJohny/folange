import React, { useEffect, useState } from "react";
import { db } from "../firebase"; // adjust if your Firebase file path differs
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { FaTimes } from "react-icons/fa";

const OrdersModal = ({ onClose }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    setUser(currentUser);

    if (!currentUser) {
      setLoading(false);
      return;
    }

    // 🔹 Define admin emails or IDs here
    const adminEmails = ["admin@b10eatery.com", "ezekiel@b10eatery.com"];
    setIsAdmin(adminEmails.includes(currentUser.email));

    const fetchOrders = async () => {
      try {
        let q;

        if (adminEmails.includes(currentUser.email)) {
          // 🔹 Fetch all orders for admin
          q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
        } else {
          // 🔹 Fetch only user’s orders
          q = query(
            collection(db, "orders"),
            where("userId", "==", currentUser.uid),
            orderBy("createdAt", "desc")
          );
        }

        const querySnapshot = await getDocs(q);
        const orderList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setOrders(orderList);
      } catch (error) {
        console.error("Error fetching orders:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md max-h-[80vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800"
        >
          <FaTimes size={18} />
        </button>

        <div className="p-5">
          <h2 className="text-lg font-bold mb-4 text-center text-gray-800">
            {isAdmin ? "All Customer Orders" : "My Orders"}
          </h2>

          {loading ? (
            <p className="text-center text-gray-500 py-4">Loading orders...</p>
          ) : orders.length === 0 ? (
            <p className="text-center text-gray-500 py-4">
              No orders found yet.
            </p>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="border border-gray-200 rounded-lg p-3 shadow-sm"
                >
                  <p className="font-semibold text-gray-800">
                    Order #{order.id.slice(0, 6).toUpperCase()}
                  </p>
                  <p className="text-sm text-gray-600">
                    Total: ₦{order.total?.toLocaleString() || "0"}
                  </p>
                  <p className="text-sm text-gray-500">
                    Status:{" "}
                    <span className="font-medium text-green-600">
                      {order.status || "Pending"}
                    </span>
                  </p>

                  {isAdmin && (
                    <p className="text-xs text-gray-400 mt-1">
                      User: {order.userEmail || "Guest"}
                    </p>
                  )}

                  <div className="mt-2 text-xs text-gray-500 space-y-1">
                    {order.items?.map((item, idx) => (
                      <p key={idx}>
                        • {item.name} × {item.quantity}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrdersModal;
