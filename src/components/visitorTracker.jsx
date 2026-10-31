import React, { useState } from "react";
import { useMyContext } from "../Context/MyContext";
import { toast } from "react-toastify";

const VisitorsTracker = () => {
  const { visitors: contextVisitors, currentUser, deleteVisitor } = useMyContext();
  const [expandedVisitor, setExpandedVisitor] = useState(null);
  const userRole = currentUser?.role || "Regular User";

  // ❌ Old Firestore fetch commented out
  /*
  useEffect(() => {
    const fetchVisitors = async () => {
      try {
        const q = query(collection(db, "visitors"), orderBy("visitTime", "desc"));
        const snap = await getDocs(q);
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVisitors(data);
      } catch (err) {
        console.error("❌ Error fetching visitors:", err);
        toast.error("Failed to load visitors.");
      } finally {
        setLoading(false);
      }
    };
    fetchVisitors();
  }, []);
  */

  // 🔹 New delete using context
  const handleDeleteVisitor = async (id) => {
    if (userRole !== "admin") {
      toast.warn("Only admins can delete visitor records.");
      return;
    }

    // ❌ Delete confirmation commented for now
    // if (!window.confirm("Are you sure you want to delete this visitor record?")) return;

    try {
      await deleteVisitor(id);
      toast.success("Visitor deleted successfully.");
    } catch (err) {
      console.error("❌ Error deleting visitor:", err);
      toast.error("Failed to delete visitor.");
    }
  };

  if (!contextVisitors)
    return (
      <div className="text-center py-10 text-gray-500 font-medium">
        Loading visitors...
      </div>
    );

  return (
    <div
      className="table-container overflow-x-auto overflow-y-auto w-full border border-gray-200 rounded-xl mt-6"
      style={{ maxHeight: "80vh" }}
    >
      <table className="min-w-[1000px] w-full border border-gray-200 rounded-xl overflow-hidden">
        <thead className="bg-gradient-to-r from-red-600 to-red-500 text-white sticky top-0 z-10">
          <tr>
            <th className="py-3 px-4 text-left">Visitor ID</th>
            <th className="py-3 px-4 text-left">User (if linked)</th>
            <th className="py-3 px-4 text-left">IP Address</th>
            <th className="py-3 px-4 text-left">Page Visited</th>
            <th className="py-3 px-4 text-left">Referrer</th>
            <th className="py-3 px-4 text-left">Visit Count</th>
            <th className="py-3 px-4 text-left">Device</th>
            <th className="py-3 px-4 text-left">Date</th>
            <th className="py-3 px-4 text-center">Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-200">
          {contextVisitors.length === 0 ? (
            <tr>
              <td colSpan="9" className="text-center py-8 text-gray-500">
                No visitors yet
              </td>
            </tr>
          ) : (
            contextVisitors.map((v) => (
              <React.Fragment key={v.id}>
                <tr
                  onClick={() =>
                    setExpandedVisitor(expandedVisitor === v.id ? null : v.id)
                  }
                  className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                    expandedVisitor === v.id ? "bg-gray-50" : ""
                  }`}
                >
                  <td className="py-3 px-4 font-semibold text-gray-800">
                    {v.visitorId?.slice(0, 8) || "—"}
                  </td>

                  {/* ⭐ IMPROVED USER DISPLAY: No more Anonymous if email exists */}
                  <td className="py-3 px-4 text-gray-700">
                    {v.userId || v.userEmail
                      ? `${v.userName || v.userEmail || "Unnamed"} (${v.userEmail || v.userId})`
                      : "Anonymous"}
                  </td>

                  <td className="py-3 px-4 text-gray-700">{v.ip || "—"}</td>
                  <td className="py-3 px-4 text-gray-700">{v.page || "—"}</td>
                  <td className="py-3 px-4 text-gray-700">{v.referrer || "Direct"}</td>
                  <td className="py-3 px-4 text-gray-700">{v.visitCount || 1}</td>

                  <td className="py-3 px-4 text-gray-700 truncate max-w-[180px]">
                    {v.userAgent?.slice(0, 30)}...
                  </td>

                <td className="py-3 px-4 text-gray-600">
  {v.lastVisit
    ? new Date(v.lastVisit.toDate()).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—"}
</td>


                  <td className="py-3 px-4 text-center flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedVisitor(expandedVisitor === v.id ? null : v.id);
                      }}
                      className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full"
                    >
                      {expandedVisitor === v.id ? "Close" : "View"}
                    </button>

                    {userRole === "admin" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteVisitor(v.id);
                        }}
                        className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1 rounded-full"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>

                {expandedVisitor === v.id && (
                  <tr className="bg-gray-50">
                    <td colSpan="9" className="py-4 px-6">
                      <div className="text-sm text-gray-700 space-y-3">
                        <p>
                          <span className="font-semibold">Full User Agent:</span>{" "}
                          {v.userAgent || "—"}
                        </p>

                        <p>
                          <span className="font-semibold">Linked to User:</span>{" "}
                          {v.userId || v.userEmail ? "✅ Yes" : "❌ No"}
                        </p>

                        {v.userEmail && (
                          <p>
                            <span className="font-semibold">Email:</span> {v.userEmail}
                          </p>
                        )}

                        {v.userId && (
                          <p>
                            <span className="font-semibold">User ID:</span> {v.userId}
                          </p>
                        )}

                        <p className="text-xs text-gray-500 italic">
                          Managed by: {currentUser?.name || currentUser?.email || "—"}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default VisitorsTracker;
