import React from "react";

const Mission = () => {
  return (
    <section className="py-20 px-5 md:px-20 bg-white text-gray-800">
      <h3 className="text-3xl font-bold text-gray-900 text-center uppercase tracking-wide mb-12">
        Our Vision & Mission
      </h3>

      <div className="grid lg:grid-cols-2 gap-12">
        <div>
          <h4 className="text-2xl font-semibold text-gray-800 mb-4">Vision</h4>
          <p className="text-lg text-gray-700 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 p-4 border-l-4 border-gray-800 rounded-lg shadow-md">
            To be the leading brand in kitchen utensil importation and supply,
            making quality products accessible to every home and business.
          </p>
        </div>

        <div>
          <h4 className="text-2xl font-semibold text-gray-800 mb-4">Mission</h4>
          <p className="text-lg text-gray-700 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 p-4 border-l-4 border-gray-800 rounded-lg shadow-md">
            To provide durable, affordable, and stylish kitchen utensils with
            seamless delivery services, ensuring customer satisfaction and trust
            in every transaction.
          </p>
        </div>
      </div>
    </section>
  );
};

export default Mission;
