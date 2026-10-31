
import React from "react";
import { FaSearch } from "react-icons/fa";
import { useMyContext } from "../Context/MyContext";

function SearchBar() {
  const { searchQuery, setSearchQuery } = useMyContext();

  const handleSubmit = (event) => {
    event.preventDefault();
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  return (
    <div className="mt-2 w-full overflow-visible px-3">
      <form
        onSubmit={handleSubmit}
        className="flex h-11 w-full items-center rounded-full border border-[#D4AF37]/50 bg-white px-3 shadow-sm transition-all duration-200 focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/20"
        style={{
          overflow: "visible",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <input
          type="search"
          value={searchQuery || ""}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search Folange products..."
          aria-label="Search Folange products"
          className="min-w-0 flex-grow border-none bg-transparent px-2 text-sm text-[#6D501C] outline-none placeholder:text-[#A8987A]"
        />

        {searchQuery && (
          <button
            type="button"
            onClick={handleClearSearch}
            aria-label="Clear search"
            className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-[#A8987A] transition-colors hover:bg-[#FFFCF7] hover:text-[#8A6517]"
          >
            ✕
          </button>
        )}

        <button
          type="submit"
          aria-label="Search"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#D4AF37] text-white transition-colors duration-200 hover:bg-[#8A6517]"
          style={{ flexBasis: "40px" }}
        >
          <FaSearch className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export default SearchBar;
