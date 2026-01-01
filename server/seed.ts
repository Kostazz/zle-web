import "dotenv/config";
import { db } from "./db";
import { products } from "@shared/schema";

const initialProducts = [
	{
		id: "zle-hoodie-alpha",
		name: "ZLE HOODIE ALPHA",
		price: 1290,
		sizes: ["S", "M", "L", "XL", "XXL"],
		image: "/images/products/hoodie.jpg",
		images: null,
		category: "hoodie",
		description:
			"Černá hoodie s bílým ZLE logem. Raw print. 100% bavlna, heavy weight.",
		stock: 50,
		isActive: true,
	},
	{
		id: "zle-hoodie-crew",
		name: "ZLE CREW HOODIE",
		price: 1390,
		sizes: ["S", "M", "L", "XL"],
		image: "/images/products/hoodie.jpg",
		images: null,
		category: "hoodie",
		description:
			"Limitovaná crew edice. Bílé logo + crew list na zádech. Premium quality.",
		stock: 30,
		isActive: true,
	},
	{
		id: "zle-tee-classic",
		name: "ZLE TEE CLASSIC",
		price: 590,
		sizes: ["S", "M", "L", "XL", "XXL"],
		image: "/images/products/tee.jpg",
		images: null,
		category: "tee",
		description: "Klasické černé tričko s bílým ZLE logem. 100% bavlna.",
		stock: 100,
		isActive: true,
	},
	{
		id: "zle-tee-underground",
		name: "ZLE UNDERGROUND TEE",
		price: 690,
		sizes: ["S", "M", "L", "XL"],
		image: "/images/products/tee.jpg",
		images: null,
		category: "tee",
		description: "Underground edice s velkým grafickým potiskem. Street vibe.",
		stock: 75,
		isActive: true,
	},
	{
		id: "zle-cap-og",
		name: "ZLE CAP OG",
		price: 490,
		sizes: ["ONE SIZE"],
		image: "/images/products/cap.jpg",
		images: null,
		category: "cap",
		description:
			"Černá kšiltovka s vyšitým ZLE logem. Nastavitelná velikost.",
		stock: 60,
		isActive: true,
	},
	{
		id: "zle-crewneck-heavy",
		name: "ZLE CREWNECK HEAVY",
		price: 1090,
		sizes: ["S", "M", "L", "XL"],
		image: "/images/products/crewneck.jpg",
		images: null,
		category: "crewneck",
		description: "Heavy weight crewneck. Minimalistický design. Raw print.",
		stock: 40,
		isActive: true,
	},
	{
		id: "zle-beanie-winter",
		name: "ZLE BEANIE",
		price: 390,
		sizes: ["ONE SIZE"],
		image: "/images/products/beanie.jpg",
		images: null,
		category: "beanie",
		description: "Černá beanie s vyšitým ZLE logem. Acryl/vlna mix.",
		stock: 80,
		isActive: true,
	},
	{
		id: "zle-tee-fire",
		name: "ZLE FIRE TEE",
		price: 650,
		sizes: ["S", "M", "L", "XL", "XXL"],
		image: "/images/products/tee.jpg",
		images: null,
		category: "tee",
		description: "Limitovaná edice s retro fire logem. Sběratelský kus.",
		stock: 25,
		isActive: true,
	},
];

async function seed() {
	console.log("Seeding products...");

	for (const product of initialProducts) {
		await db
			.insert(products)
			.values(product)
			.onConflictDoUpdate({
				target: products.id,
				set: {
					name: product.name,
					price: product.price,
					sizes: product.sizes,
					image: product.image,
					images: product.images,
					category: product.category,
					description: product.description,
					stock: product.stock,
					isActive: product.isActive,
				},
			});
		console.log(`  ✓ ${product.name}`);
	}

	console.log("Seeding complete!");
	process.exit(0);
}

seed().catch((err) => {
	console.error("Seeding failed:", err);
	process.exit(1);
});
