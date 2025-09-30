import { FormEvent, useState } from "react";

const propertyTypes = ["house", "condo", "townhouse", "duplex", "land"];
const lifestyleOptions = [
  "Near transit",
  "Waterfront",
  "Walkable neighbourhood",
  "Close to schools",
  "Parks and trails"
];

export const WishlistBuilder = () => {
  const [name, setName] = useState("Family home in Oakville");
  const [budgetMin, setBudgetMin] = useState(650000);
  const [budgetMax, setBudgetMax] = useState(850000);
  const [timeline, setTimeline] = useState("6-12 months");
  const [mortgageOptIn, setMortgageOptIn] = useState(true);
  const [selectedLifestyle, setSelectedLifestyle] = useState<string[]>(["Near transit"]);

  const handleCheckbox = (value: string) => {
    setSelectedLifestyle((previous) =>
      previous.includes(value)
        ? previous.filter((item) => item !== value)
        : [...previous, value]
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    alert(
      `Wishlist "${name}" saved with budget ${budgetMin} - ${budgetMax}, timeline ${timeline}, mortgage opt-in ${mortgageOptIn}.`
    );
  };

  return (
    <section>
      <h2>Create wishlist</h2>
      <p>
        Describe preferred neighbourhoods, budgets, and feature priorities. The
        backend match engine will pair these criteria with seller listings using
        geospatial and feature weighting once APIs are wired up.
      </p>
      <form className="card" onSubmit={handleSubmit}>
        <label>
          Wishlist name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Budget minimum (CAD)
          <input
            type="number"
            value={budgetMin}
            onChange={(event) => setBudgetMin(Number(event.target.value))}
            min={0}
          />
        </label>
        <label>
          Budget maximum (CAD)
          <input
            type="number"
            value={budgetMax}
            onChange={(event) => setBudgetMax(Number(event.target.value))}
            min={budgetMin}
          />
        </label>
        <fieldset>
          <legend>Desired property types</legend>
          <div className="option-grid">
            {propertyTypes.map((type) => (
              <label key={type}>
                <input type="checkbox" defaultChecked={type === "house"} /> {type}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Timeline
          <select value={timeline} onChange={(event) => setTimeline(event.target.value)}>
            <option value="0-3 months">0-3 months</option>
            <option value="3-6 months">3-6 months</option>
            <option value="6-12 months">6-12 months</option>
            <option value=">12 months">More than 12 months</option>
          </select>
        </label>
        <fieldset>
          <legend>Lifestyle & amenities</legend>
          <div className="option-grid">
            {lifestyleOptions.map((option) => (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={selectedLifestyle.includes(option)}
                  onChange={() => handleCheckbox(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={mortgageOptIn}
            onChange={(event) => setMortgageOptIn(event.target.checked)}
          />
          I would like verified mortgage agents to contact me with financing options.
        </label>
        <button type="submit">Save wishlist</button>
      </form>
    </section>
  );
};
