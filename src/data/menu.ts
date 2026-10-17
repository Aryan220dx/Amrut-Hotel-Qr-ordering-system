export type MenuItem = {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  category: string;
  image: string;
  tag?: string;
  customizations?: string[];
};

// Illustrative placeholder content only. Replace names, prices and availability
// with owner-verified Hotel Amrut data before launch.
export const menuCategories = ["Popular", "Seafood", "Mains", "Sides", "Drinks"];

export const menuItems: MenuItem[] = [
  { id: "prawns", name: "Coastal prawn curry", description: "Coconut, kokum & house-ground spices", pricePaise: 38500, category: "Seafood", image: "https://images.unsplash.com/photo-1625944525533-473f1a3d54e7?auto=format&fit=crop&w=900&q=85", tag: "A table favourite", customizations: ["Mild", "Medium", "Spicy"] },
  { id: "fish", name: "Pan-seared catch", description: "Crisp edges, lime & a little sea salt", pricePaise: 42000, category: "Seafood", image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=85", tag: "Coastal pick", customizations: ["Mild", "Medium", "Spicy"] },
  { id: "thali", name: "Amrut fish thali", description: "Today's catch, rice, sides & curry", pricePaise: 49500, category: "Mains", image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85", tag: "A little bit of everything" },
  { id: "veg", name: "Seasonal veg thali", description: "A comforting spread from the coast", pricePaise: 28500, category: "Mains", image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85", customizations: ["Mild", "Medium", "Spicy"] },
  { id: "calamari", name: "Golden calamari", description: "Lightly crisp, with a bright lime dip", pricePaise: 32500, category: "Seafood", image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=85", tag: "For the table" },
  { id: "rice", name: "Steamed rice", description: "Soft, fragrant & ready for curry", pricePaise: 9000, category: "Sides", image: "https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=900&q=85" },
  { id: "solkadhi", name: "Chilled solkadhi", description: "Kokum, coconut & a cooling finish", pricePaise: 7500, category: "Drinks", image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85" },
];

export const formatINR = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
