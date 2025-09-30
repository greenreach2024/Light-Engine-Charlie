import { FormEvent } from "react";

export const ListingWizard = () => {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    alert("Listing saved and sent to the match engine queue.");
  };

  return (
    <section>
      <h2>Create listing</h2>
      <p>
        Capture property details, upload media, and trigger the match engine.
        The API will geocode the address and push the listing into Azure
        Cognitive Search.
      </p>
      <form className="card" onSubmit={handleSubmit}>
        <label>
          Address
          <input placeholder="123 Lakeshore Rd, Oakville, ON" />
        </label>
        <label>
          Price (CAD)
          <input type="number" min={0} placeholder="899000" />
        </label>
        <label>
          Property type
          <select defaultValue="house">
            <option value="house">House</option>
            <option value="condo">Condo</option>
            <option value="townhouse">Townhouse</option>
            <option value="land">Land</option>
          </select>
        </label>
        <label>
          Bedrooms
          <input type="number" min={0} defaultValue={3} />
        </label>
        <label>
          Bathrooms
          <input type="number" min={0} defaultValue={2} />
        </label>
        <label>
          Description
          <textarea rows={4} placeholder="Highlight unique selling points." />
        </label>
        <label>
          Upload photos
          <input type="file" multiple />
        </label>
        <button type="submit">Save listing</button>
      </form>
    </section>
  );
};
