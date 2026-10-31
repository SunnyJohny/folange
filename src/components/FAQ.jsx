
import React, { useState } from "react";

const faqData = [
  {
    question: "What products can I find at Folange Beauty Lounge?",
    answer:
      "Folange Beauty Lounge offers beauty and cosmetic products. Browse the Store section to explore the available products, descriptions, prices, and other product details.",
  },
  {
    question: "How do I know if a product is available?",
    answer:
      "Product availability is indicated on the product listing. If you need clarification about a particular product, please contact our support team before placing your order.",
  },
  {
    question: "How do I place an order?",
    answer:
      "Browse the Store, select the products you want, add them to your cart, and proceed to checkout. Follow the instructions displayed during checkout to complete your order.",
  },
  {
    question: "Do I need an account before shopping?",
    answer:
      "Follow the account and checkout instructions displayed on the website. If you are asked to sign in or create an account, complete that step to continue with your order.",
  },
  {
    question: "How can I choose the right beauty product?",
    answer:
      "Read the product description and any available ingredients, usage instructions, and suitability information before purchasing. If you need more information about a product, contact Folange support for assistance.",
  },
  {
    question: "What should I know before using a new skincare or beauty product?",
    answer:
      "Always read the product label and follow the manufacturer's instructions. If you have sensitive skin or are unsure whether a product is suitable for you, consider seeking professional advice and performing a patch test where appropriate.",
  },
  {
    question: "What payment methods are available?",
    answer:
      "Available payment options and payment instructions will be displayed during checkout. Please follow the instructions provided on the website when completing your purchase.",
  },
  {
    question: "How long does delivery take?",
    answer:
      "Delivery timelines and applicable charges depend on your location and order. Please check the delivery information provided during checkout or contact our support team for clarification before placing your order.",
  },
  {
    question: "How can I check the status of my order?",
    answer:
      "Keep your order confirmation or reference details after checkout. You can contact Folange customer support through WhatsApp for assistance with your order status.",
  },
  {
    question: "Can I request a return or refund?",
    answer:
      "Please contact Folange customer support before returning an item or requesting a refund. The eligibility requirements and applicable process should be confirmed directly with our team based on your order.",
  },
  {
    question: "What is the Folange Academy?",
    answer:
      "Folange Academy is the learning section of Folange Beauty Lounge. Visit the Academy page to explore available courses, course descriptions, duration, and enrollment information.",
  },
  {
    question: "How do I enroll in an Academy course?",
    answer:
      "Visit the Academy section, select the course you are interested in, and follow the enrollment instructions displayed on the course page. If you need help with enrollment, contact our support team.",
  },
  {
    question: "What can I find in the Gallery?",
    answer:
      "The Gallery showcases selected beauty-related images, work, and updates from Folange Beauty Lounge. Visit the Gallery page to explore the displayed content.",
  },
  {
    question: "How can I contact Folange customer support?",
    answer: (
      <span>
        You can call or send us a WhatsApp message at{" "}
        <a
          href="https://wa.me/2348066044777?text=Hello%20Folange%20Beauty%20Lounge%2C%20I%20would%20like%20to%20make%20an%20inquiry."
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#8A6517] hover:text-[#6F5012] hover:underline"
        >
          +234 806 604 4777
        </a>
        . Our team will be happy to assist you with product inquiries,
        orders, Academy enrollment, and other questions.
      </span>
    ),
  },
];

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(null);

  const toggleAnswer = (index) => {
    setOpenIndex((currentIndex) =>
      currentIndex === index ? null : index
    );
  };

  return (
    <section
      id="faq"
      className="bg-[#FFFCF7] text-[#3F3528] py-12 px-5 md:px-12 lg:px-20"
    >
      <div className="w-full max-w-6xl mx-auto bg-gradient-to-br from-[#FFFCF7] via-white to-[#F3E9D7] rounded-2xl border border-[#E5D6B5] shadow-sm p-6 md:p-10 lg:p-12">
        {/* Heading */}
        <div className="text-center mb-10">
          <p className="text-xs md:text-sm uppercase tracking-[0.25em] font-semibold text-[#8A6517] mb-3">
            Folange Beauty Lounge
          </p>

          <h2 className="text-3xl md:text-4xl font-bold text-[#3F3528] tracking-tight font-serif">
            Frequently Asked Questions
          </h2>

          <div className="w-20 h-1 bg-[#D4AF37] mx-auto mt-5 rounded-full" />

          <p className="text-sm md:text-base text-[#7D7262] mt-4 max-w-2xl mx-auto leading-relaxed">
            Find helpful answers to common questions about shopping,
            beauty products, our Academy, and services at{" "}
            <span className="font-semibold text-[#8A6517]">
              Folange Beauty Lounge
            </span>
            .
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="space-y-4">
          {faqData.map((item, index) => {
            const isOpen = openIndex === index;

            return (
              <div
                key={index}
                className={`overflow-hidden rounded-xl border bg-white transition-all duration-300 ${
                  isOpen
                    ? "border-[#D4AF37] shadow-md"
                    : "border-[#E5D6B5] shadow-sm hover:border-[#B08D45]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleAnswer(index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  className={`w-full text-left p-4 md:p-5 flex justify-between items-center gap-4 font-semibold transition-colors duration-300 ${
                    isOpen
                      ? "bg-[#F3E9D7] text-[#6F5012]"
                      : "text-[#493723] hover:bg-[#FFFCF5]"
                  }`}
                >
                  <span className="text-sm md:text-base leading-relaxed">
                    {item.question}
                  </span>

                  <span
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xl font-semibold transition-all duration-300 ${
                      isOpen
                        ? "bg-[#D4AF37] text-white"
                        : "bg-[#F3E9D7] text-[#8A6517]"
                    }`}
                    aria-hidden="true"
                  >
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                {isOpen && (
                  <div
                    id={`faq-answer-${index}`}
                    className="p-4 md:p-5 text-sm md:text-base text-[#6D501C] leading-relaxed border-t border-[#E5D6B5] bg-white"
                  >
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Support Footer */}
        <div className="mt-10 text-center border-t border-[#E5D6B5] pt-8">
          <h3 className="text-lg md:text-xl font-semibold text-[#3F3528] font-serif">
            Still have questions?
          </h3>

          <p className="text-sm text-[#7D7262] mt-2 mb-5">
            Our team is available to help you with your inquiries.
          </p>

          <a
            href="https://wa.me/2348066044777?text=Hello%20Folange%20Beauty%20Lounge%2C%20I%20need%20assistance."
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-[#D4AF37] hover:bg-[#E7C65C] text-white font-semibold text-sm transition-all duration-300 shadow-sm"
          >
            <span>Chat with us on WhatsApp</span>
          </a>
        </div>
      </div>
    </section>
  );
};

export default FAQ;
