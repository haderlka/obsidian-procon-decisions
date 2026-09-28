// Lints with the same rules the Obsidian community-plugin review uses.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores(["main.js", "node_modules/", "esbuild.config.mjs", "version-bump.mjs", "tests/", "tools/"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// The declarative settings API only exists from Obsidian 1.13. Adopting it would
			// raise minAppVersion far above what the rest of the plugin needs (1.4.0).
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
]);
