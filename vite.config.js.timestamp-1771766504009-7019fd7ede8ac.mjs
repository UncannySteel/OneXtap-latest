// vite.config.js
import { defineConfig } from "file:///Users/azzah/Desktop/OnexTap_Extension/node_modules/vite/dist/node/index.js";
import react from "file:///Users/azzah/Desktop/OnexTap_Extension/node_modules/@vitejs/plugin-react/dist/index.js";
import { crx } from "file:///Users/azzah/Desktop/OnexTap_Extension/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// extension/manifest.json
var manifest_default = {
  manifest_version: 3,
  name: "Onextap",
  version: "1.0.1",
  description: "Autofill job applications.",
  permissions: [
    "storage",
    "activeTab",
    "scripting",
    "tabs"
  ],
  host_permissions: [
    "https://*.supabase.co/*",
    "http://localhost:5173/*",
    "http://localhost:3001/*"
  ],
  externally_connectable: {
    matches: [
      "http://localhost:5173/*"
    ]
  },
  background: {
    service_worker: "extension/background.js"
  },
  action: {
    default_popup: "index.html",
    default_icon: "icon.png"
  }
};

// vite.config.js
import tailwindcss from "file:///Users/azzah/Desktop/OnexTap_Extension/node_modules/tailwindcss/lib/index.js";
import autoprefixer from "file:///Users/azzah/Desktop/OnexTap_Extension/node_modules/autoprefixer/lib/autoprefixer.js";
var vite_config_default = defineConfig({
  base: "./",
  // Required for Chrome Extension: relative paths work; absolute "/" causes MIME errors
  plugins: [
    react(),
    crx({ manifest: manifest_default })
    // This handles the Chrome Extension build logic
  ],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173
    }
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()]
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiLCAiZXh0ZW5zaW9uL21hbmlmZXN0Lmpzb24iXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvYXp6YWgvRGVza3RvcC9PbmV4VGFwX0V4dGVuc2lvblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2F6emFoL0Rlc2t0b3AvT25leFRhcF9FeHRlbnNpb24vdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2F6emFoL0Rlc2t0b3AvT25leFRhcF9FeHRlbnNpb24vdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgeyBjcnggfSBmcm9tICdAY3J4anMvdml0ZS1wbHVnaW4nO1xuaW1wb3J0IG1hbmlmZXN0IGZyb20gJy4vZXh0ZW5zaW9uL21hbmlmZXN0Lmpzb24nO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ3RhaWx3aW5kY3NzJztcbmltcG9ydCBhdXRvcHJlZml4ZXIgZnJvbSAnYXV0b3ByZWZpeGVyJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZTogJy4vJywgLy8gUmVxdWlyZWQgZm9yIENocm9tZSBFeHRlbnNpb246IHJlbGF0aXZlIHBhdGhzIHdvcms7IGFic29sdXRlIFwiL1wiIGNhdXNlcyBNSU1FIGVycm9yc1xuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBjcngoeyBtYW5pZmVzdCB9KSwgLy8gVGhpcyBoYW5kbGVzIHRoZSBDaHJvbWUgRXh0ZW5zaW9uIGJ1aWxkIGxvZ2ljXG4gIF0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICBobXI6IHtcbiAgICAgIHBvcnQ6IDUxNzMsXG4gICAgfSxcbiAgfSxcbiAgY3NzOiB7XG4gICAgcG9zdGNzczoge1xuICAgICAgcGx1Z2luczogW3RhaWx3aW5kY3NzKCksIGF1dG9wcmVmaXhlcigpXVxuICAgIH1cbiAgfVxufSk7XG5cblxuXG4iLCAie1xuICBcIm1hbmlmZXN0X3ZlcnNpb25cIjogMyxcbiAgXCJuYW1lXCI6IFwiT25leHRhcFwiLFxuICBcInZlcnNpb25cIjogXCIxLjAuMVwiLFxuICBcImRlc2NyaXB0aW9uXCI6IFwiQXV0b2ZpbGwgam9iIGFwcGxpY2F0aW9ucy5cIixcbiAgXCJwZXJtaXNzaW9uc1wiOiBbXG4gICAgXCJzdG9yYWdlXCIsXG4gICAgXCJhY3RpdmVUYWJcIixcbiAgICBcInNjcmlwdGluZ1wiLFxuICAgIFwidGFic1wiXG4gIF0sXG4gIFwiaG9zdF9wZXJtaXNzaW9uc1wiOiBbXG4gICAgXCJodHRwczovLyouc3VwYWJhc2UuY28vKlwiLFxuICAgIFwiaHR0cDovL2xvY2FsaG9zdDo1MTczLypcIixcbiAgICBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMS8qXCJcbiAgXSxcbiAgXCJleHRlcm5hbGx5X2Nvbm5lY3RhYmxlXCI6IHtcbiAgICBcIm1hdGNoZXNcIjogW1xuICAgICAgXCJodHRwOi8vbG9jYWxob3N0OjUxNzMvKlwiXG4gICAgXVxuICB9LFxuICBcImJhY2tncm91bmRcIjoge1xuICAgIFwic2VydmljZV93b3JrZXJcIjogXCJleHRlbnNpb24vYmFja2dyb3VuZC5qc1wiXG4gIH0sXG4gIFwiYWN0aW9uXCI6IHtcbiAgICBcImRlZmF1bHRfcG9wdXBcIjogXCJpbmRleC5odG1sXCIsXG4gICAgXCJkZWZhdWx0X2ljb25cIjogXCJpY29uLnBuZ1wiXG4gIH1cbn0iXSwKICAibWFwcGluZ3MiOiAiO0FBQW9TLFNBQVMsb0JBQW9CO0FBQ2pVLE9BQU8sV0FBVztBQUNsQixTQUFTLFdBQVc7OztBQ0ZwQjtBQUFBLEVBQ0Usa0JBQW9CO0FBQUEsRUFDcEIsTUFBUTtBQUFBLEVBQ1IsU0FBVztBQUFBLEVBQ1gsYUFBZTtBQUFBLEVBQ2YsYUFBZTtBQUFBLElBQ2I7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQUEsRUFDQSxrQkFBb0I7QUFBQSxJQUNsQjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUFBLEVBQ0Esd0JBQTBCO0FBQUEsSUFDeEIsU0FBVztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsWUFBYztBQUFBLElBQ1osZ0JBQWtCO0FBQUEsRUFDcEI7QUFBQSxFQUNBLFFBQVU7QUFBQSxJQUNSLGVBQWlCO0FBQUEsSUFDakIsY0FBZ0I7QUFBQSxFQUNsQjtBQUNGOzs7QUR4QkEsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxrQkFBa0I7QUFFekIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBO0FBQUEsRUFDTixTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLEVBQUUsMkJBQVMsQ0FBQztBQUFBO0FBQUEsRUFDbEI7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLEtBQUs7QUFBQSxNQUNILE1BQU07QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBLEVBQ0EsS0FBSztBQUFBLElBQ0gsU0FBUztBQUFBLE1BQ1AsU0FBUyxDQUFDLFlBQVksR0FBRyxhQUFhLENBQUM7QUFBQSxJQUN6QztBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
