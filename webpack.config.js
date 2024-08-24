import MiniCssExtractPlugin from "mini-css-extract-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
	mode: "development",
	devtool: "inline-source-map",
	entry: "./src/main.jsx",
	output: {
		filename: "stdout.js",
		path: path.resolve(__dirname, "dist"),
		clean: true
	},
	module: {
		rules: [
			{
				test: /\.jsx?$/,
				exclude: /node_modules/,
				use: {
					loader: "babel-loader"
				}
			},
			{
				test: /\.css$/i,
				use: [MiniCssExtractPlugin.loader, "css-loader"]
			}
		]
	},
	plugins: [
		new MiniCssExtractPlugin(),
		new CopyWebpackPlugin({
			patterns: [
				{ from: "manifest.json" },
				{ from: "index.html" },
				{ from: "src/init.js", to: "init.js" }
			]
		})
	]
};
