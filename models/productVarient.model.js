import mongoose from "mongoose";

const sizeSchema = new mongoose.Schema({
    sizeValue: { type: String, required: true },
    stock: { type: Number, default: 0 },
    price: { type: Number, required: true },
    discountedPrice: { type: Number, default: null }
});

const colorSchema = new mongoose.Schema({
    colorName: { type: String, required: true },
    images: [String],
    stock: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    discountedPrice: { type: Number, default: null },
    sizes: [sizeSchema]
});

const productVariantSchema = new mongoose.Schema(
    {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "product", required: true },
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "seller", required: true },
        sku: { type: String, unique: true, required: true },
        color: colorSchema,
        variantTitle: { type: String, required: true },
        variantDescription: { type: String, required: true },
        emi: Boolean,
        overview: [
            {
                key: { type: String, required: true },
                value: { type: String, required: true }
            }
        ],
        key_features: [
            {
                title: { type: String, required: true },
                description: { type: String }
            }
        ],
        specification: [
            {
                title: { type: String, required: true },
                details: [
                    {
                        key: { type: String, required: true },
                        value: { type: String, required: true }
                    }
                ]
            }
        ],

    },
    { timestamps: true }
);

export default mongoose.model("productVariant", productVariantSchema);