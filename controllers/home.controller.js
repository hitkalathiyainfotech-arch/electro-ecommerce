import mongoose from "mongoose";
import brandModel from "../models/brand.model.js";
import productModel from "../models/product.model.js";
import productVarientModel from "../models/productVarient.model.js";
import { sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { createProductVariant } from "./productVariant.controller.js";
import reviewModel from "../models/review.model.js";

export const newArrival = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const products = await productModel
      .find({
        createdAt: { $gte: thirtyDaysAgo },
        isActive: true
      })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate({
        path: "variantId",
        options: { limit: 1 }
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId.length > 0 ? [p.variantId[0]] : []
      }
    });

    return sendSuccessResponse(res, "New Arrivals fetched successfully", formatted);
  } catch (error) {
    console.log("error while get newArrival : " + error);
    return sendErrorResponse(res, 500, "error while get newArrival", error);
  }
}

export const bestSeller = async (req, res) => {
  try {
    const products = await productModel
      .find({})
      .sort({ sold: -1 })
      .limit(15)
      .populate({
        path: "variantId",
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "best selling Products", formatted);
  } catch (error) {
    console.log("Error while bestSeller", error)
    return sendErrorResponse(res, 500, "Error while bestSeller", error)
  }
}

export const newProducts = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const products = await productModel
      .find({
        isActive: true,
        createdAt: { $lt: thirtyDaysAgo }
      })
      .sort({ view: -1, sold: -1 })
      .limit(6)
      .populate({
        path: "variantId",
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "New Products fetched successfully", formatted);
  } catch (error) {
    console.log("Error while fetching new products", error);
    return sendErrorResponse(res, 500, "Error while fetching new products", error);
  }
}

export const trendingDeals = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const products = await productModel
      .aggregate([
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ["$sold", 2] },
                { $multiply: ["$view", 1] },
                {
                  $cond: [
                    { $gte: ["$createdAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                    50,
                    0
                  ]
                }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]);

    const ids = products.map(x => x._id);

    const finalProducts = await productModel
      .find({ _id: { $in: ids } })
      .populate({
        path: "variantId",
      });

    const formatted = finalProducts.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "Trending Deals Products", formatted);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching trending deals", error);
  }
};

export const grabNowDeals = async (req, res) => {
  try {
    const variants = await productVarientModel.find({})
      .populate("productId")
      .populate("sellerId");

    const deals = [];

    for (const v of variants) {
      const color = v.color;
      if (!color) continue;

      let effectivePrice = 0;
      let originalPrice = 0;
      let stock = 0;

      if (color.sizes && color.sizes.length > 0) {
        const sizesInStock = color.sizes.filter(s => s.stock > 0);
        if (sizesInStock.length === 0) continue;

        const size = sizesInStock[0];

        originalPrice = size.price;
        effectivePrice = size.discountedPrice || size.price;
        stock = size.stock;
      } else {
        if (color.stock <= 0) continue;

        originalPrice = color.price;
        effectivePrice = color.discountedPrice || color.price;
        stock = color.stock;
      }

      const discountPercent =
        originalPrice > 0
          ? Math.round(((originalPrice - effectivePrice) / originalPrice) * 100)
          : 0;

      const product = v.productId;
      if (!product) continue;

      const allVariants = await productVarientModel.find({
        productId: product._id
      });

      deals.push({
        ...product._doc,
        variantId: allVariants,
        dealDetails: {
          selectedVariantId: v._id,
          variantTitle: v.variantTitle,
          images: color.images || [],
          originalPrice,
          discountedPrice: effectivePrice,
          discountPercent,
          stock
        }
      });
    }

    deals.sort((a, b) => {
      if (b.dealDetails.discountPercent !== a.dealDetails.discountPercent) {
        return b.dealDetails.discountPercent - a.dealDetails.discountPercent;
      }
      return a.dealDetails.discountedPrice - b.dealDetails.discountedPrice;
    });

    const uniqueDeals = [];
    const seenProductIds = new Set();

    for (const deal of deals) {
      if (!seenProductIds.has(deal._id.toString())) {
        seenProductIds.add(deal._id.toString());
        uniqueDeals.push(deal);
      }
    }

    return sendSuccessResponse(res, "Grab Now Deals Fetched", uniqueDeals.slice(0, 10));
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getFiltteredProducts = async (req, res) => {
  try {
    const {
      q,
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      color,
      size,
      rating,
      sort
    } = req.query;

    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    const minRating = rating ? Number(rating) : null;

    const matchQuery = { isActive: true };

    if (q && q.trim()) {
      matchQuery.$or = [
        { title: { $regex: q.trim(), $options: "i" } },
        { description: { $regex: q.trim(), $options: "i" } }
      ];
    }

    let brandIds = [];

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      const brands = await brandModel.find(
        { categories: new mongoose.Types.ObjectId(categoryId) },
        { _id: 1 }
      );

      brandIds = brands.map(b => b._id);
      matchQuery.categories = new mongoose.Types.ObjectId(categoryId);
    }

    if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
      matchQuery.brand = new mongoose.Types.ObjectId(brandId);
    } else if (brandIds.length > 0) {
      matchQuery.brand = { $in: brandIds };
    }

    let products = await productModel.find(matchQuery)
      .populate("variantId")
      .sort({ createdAt: -1 });

    const formattedProducts = products.map(product => {
      return {
        ...product._doc,
        brand: product.brand,
        categories: product.categories,
        variantId: product.variantId || []
      };
    });

    let filteredProducts = formattedProducts;

    if (min !== null || max !== null || color || size) {
      filteredProducts = filteredProducts
        .map(product => {
          const variants = product.variantId.filter(variant => {
            let ok = true;

            const prices =
              variant.color.sizes && variant.color.sizes.length > 0
                ? variant.color.sizes.map(s =>
                  s.discountedPrice !== null ? s.discountedPrice : s.price
                )
                : [
                  variant.color.discountedPrice !== null
                    ? variant.color.discountedPrice
                    : variant.color.price
                ];

            if (min !== null) ok = ok && prices.some(p => p >= min);
            if (max !== null) ok = ok && prices.some(p => p <= max);

            if (color) {
              ok =
                ok &&
                variant.color.colorName.toLowerCase() ===
                color.toLowerCase();
            }

            if (size) {
              ok =
                ok &&
                variant.color.sizes &&
                variant.color.sizes.some(s => s.sizeValue === size);
            }

            return ok;
          });

          if (variants.length > 0) {
            return {
              ...product,
              variantId: variants
            };
          }
          return null;
        })
        .filter(Boolean);
    }

    if (minRating !== null) {
      const productIds = filteredProducts.map(p => p._id);

      const ratingAgg = await reviewModel.aggregate([
        { $match: { productId: { $in: productIds } } },
        {
          $group: {
            _id: "$productId",
            avgRating: { $avg: "$overallRating" },
            totalReviews: { $sum: 1 }
          }
        },
        {
          $match: {
            avgRating: { $gte: minRating }
          }
        }
      ]);

      const ratingMap = {};
      ratingAgg.forEach(r => {
        ratingMap[r._id.toString()] = {
          average: Number(r.avgRating.toFixed(1)),
          totalReviews: r.totalReviews
        };
      });

      filteredProducts = filteredProducts
        .filter(p => ratingMap[p._id.toString()])
        .map(p => {
          return {
            ...p,
            rating: ratingMap[p._id.toString()]
          };
        });
    }

    if (sort) {
      if (sort === "latest") {
        filteredProducts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }

      if (sort === "popular") {
        filteredProducts.sort(
          (a, b) =>
            (b.rating?.totalReviews || 0) -
            (a.rating?.totalReviews || 0)
        );
      }

      if (sort === "rating") {
        filteredProducts.sort(
          (a, b) =>
            (b.rating?.average || 0) -
            (a.rating?.average || 0)
        );
      }

      if (sort === "priceLow") {
        filteredProducts.sort((a, b) => {
          const priceA = getMinPriceFromVariants(a.variantId);
          const priceB = getMinPriceFromVariants(b.variantId);
          return priceA - priceB;
        });
      }

      if (sort === "priceHigh") {
        filteredProducts.sort((a, b) => {
          const priceA = getMinPriceFromVariants(a.variantId);
          const priceB = getMinPriceFromVariants(b.variantId);
          return priceB - priceA;
        });
      }
    }

    return sendSuccessResponse(res, "Products fetched successfully", filteredProducts);

  } catch (error) {
    console.log("error while filtering products", error);
    return sendErrorResponse(res, 500, "Error while filtering products", error);
  }
};

function getMinPriceFromVariants(variants) {
  if (!variants || variants.length === 0) return Infinity;

  let minPrice = Infinity;
  variants.forEach(variant => {
    const color = variant.color;
    if (!color) return;

    if (color.sizes && color.sizes.length > 0) {
      color.sizes.forEach(size => {
        const price = size.discountedPrice || size.price;
        if (price < minPrice) minPrice = price;
      });
    } else {
      const price = color.discountedPrice || color.price;
      if (price < minPrice) minPrice = price;
    }
  });

  return minPrice === Infinity ? 0 : minPrice;
}