import React, { useRef, useState } from 'react';
import { FaCalendar } from 'react-icons/fa';
import { useMyContext } from '../Context/MyContext';

const SalesPage = () => {
  const { sales, currentUser } = useMyContext();
  const tableRef = useRef(null);
  const isAdmin = currentUser?.role === 'admin';

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedDateOption, setSelectedDateOption] = useState('All');

  const [selectedSale, setSelectedSale] = useState(null);

  const handleRowClick = (sale) => setSelectedSale(sale);
  const handleCloseModal = () => setSelectedSale(null);

  const formatDate = (date) => date ? new Date(date).toLocaleDateString() : '-';

  // Filter sales by name and optionally by date
  const filteredSales = (sales || []).filter(sale => {
    const nameMatch = sale.customer?.name?.toLowerCase().includes(searchKeyword.toLowerCase());

    let dateMatch = true;
    if (fromDate) dateMatch = new Date(sale.date) >= new Date(fromDate);
    if (toDate) dateMatch = dateMatch && new Date(sale.date) <= new Date(toDate);

    return nameMatch && dateMatch;
  });

  // Totals
  const totalCOGS = filteredSales.reduce(
    (acc, sale) => acc + sale.products.reduce((a, p) => a + (p.costPrice || 0), 0),
    0
  );
  const totalSalesValue = filteredSales.reduce(
    (acc, sale) => acc + sale.products.reduce((a, p) => a + (p.Amount || 0), 0),
    0
  );
  const totalProductsSold = filteredSales.reduce((acc, sale) => acc + sale.products.length, 0);

  const renderFooter = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-center">
      <div>Total Sales Transactions: {filteredSales.length}</div>
      <div>Total Products Sold: {totalProductsSold}</div>
      <div>Total Sales Value: ₦{totalSalesValue.toLocaleString()}</div>
      <div>Total COGS: ₦{totalCOGS.toLocaleString()}</div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 px-4 md:px-0">
      <div className="flex-1">
        {/* Header */}
        <div className="mb-8 p-2 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-center flex-grow">Sales</h2>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center md:space-x-2 space-y-2 md:space-y-0">
          <div className="flex items-center space-x-2">
            <label className="text-lg">Dates</label>
            <select
              value={selectedDateOption}
              onChange={(e) => setSelectedDateOption(e.target.value)}
              className="border border-gray-300 rounded-md p-2 pl-4"
            >
              <option value="All">All</option>
              <option value="Today">Today</option>
              <option value="This Week">This Week</option>
              <option value="This Month">This Month</option>
              <option value="Last Month">Last Month</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <div className="relative">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-gray-300 rounded-md p-2 cursor-pointer"
              />
              <FaCalendar className="absolute top-3 right-2 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-gray-300 rounded-md p-2 cursor-pointer"
              />
              <FaCalendar className="absolute top-3 right-2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <input
            type="text"
            className="border border-gray-300 rounded-md p-2"
            placeholder="Search Customer"
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="table-container overflow-x-auto overflow-y-auto" style={{ maxHeight: '400px' }} ref={tableRef}>
          <table className="w-full table-auto border-collapse border border-black">
            <thead className="bg-gray-200 sticky top-0">
              <tr>
                <th className="border p-1">S/N</th>
                <th className="border p-1">Customer</th>
                <th className="border p-1">Date</th>
                <th className="border p-1">Trans ID</th>
                <th className="border p-1">Receipt</th>
                <th className="border p-1">Payment</th>
                <th className="border p-1">COGS</th>
                <th className="border p-1">Total Sale</th>
                <th className="border p-1">Salesperson</th>
                <th className="border p-1">Category</th>
              </tr>
            </thead>

            <tbody>
              {filteredSales.map((sale, index) => {
                const cogs = sale.products.reduce((a, p) => a + (p.costPrice || 0), 0);
                const total = sale.products.reduce((a, p) => a + (p.Amount || 0), 0);
                return (
                  <tr key={index} onClick={() => handleRowClick(sale)} style={{ cursor: 'pointer' }}>
                    <td className="border p-1">{index + 1}</td>
                    <td className="border p-1">{sale.customer?.name || '-'}</td>
                    <td className="border p-1">{formatDate(sale.date)}</td>
                    <td className="border p-1">{sale.id.substring(0, 5)}...</td>
                    <td className="border p-1">{sale.saleId}</td>
                    <td className="border p-1">{sale.payment?.method || 'N/A'}</td>
                    <td className="border p-1">₦{cogs}</td>
                    <td className="border p-1">₦{total}</td>
                    <td className="border p-1">{sale.staff?.name || '-'}</td>
                    <td className="border p-1">{sale.salesCategory || '-'}</td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr className="font-bold">
                <td className="border p-1" colSpan={6}>Totals</td>
                <td className="border p-1">₦{totalCOGS}</td>
                <td className="border p-1">₦{totalSalesValue}</td>
                <td className="border p-1" colSpan={2}></td>
              </tr>
            </tbody>
          </table>

          {renderFooter()}
        </div>
      </div>

      {/* Modal */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-4 rounded-lg w-11/12 max-w-3xl relative">
            <button
              className="absolute top-2 right-2 text-red-500 font-bold"
              onClick={handleCloseModal}
            >
              X
            </button>
            <h2 className="text-xl font-bold mb-4">Sale Details</h2>
            <p><strong>Customer:</strong> {selectedSale.customer?.name}</p>
            <p><strong>Date:</strong> {formatDate(selectedSale.date)}</p>
            <p><strong>Payment:</strong> {selectedSale.payment?.method || 'N/A'}</p>
            <div className="mt-4">
              <table className="w-full table-auto border-collapse border border-black">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="border p-1">Product</th>
                    <th className="border p-1">Qty</th>
                    <th className="border p-1">Cost Price</th>
                    <th className="border p-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSale.products.map((p, idx) => (
                    <tr key={idx}>
                      <td className="border p-1">{p.name}</td>
                      <td className="border p-1">{p.quantity}</td>
                      <td className="border p-1">₦{p.costPrice}</td>
                      <td className="border p-1">₦{p.Amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPage;
