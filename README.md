# ArkaTasks — DClean

## Fix for CSS/JS 404 errors

Windows ZIP uploads often break Cloudflare folders. **Do not use the old zip method.**

### Best way (works): upload the FOLDER

1. On your PC open:
   `C:\Users\lahir\OneDrive\Desktop\DClean - ArkaTasks\out`
2. Cloudflare → your Pages project (`dclean-arkatasks`) → **Create deployment** / Upload assets
3. **Drag the whole `out` folder** into the upload box (not a zip)
4. Deploy
5. Hard refresh the site (Ctrl+F5)

You should see styles and working buttons.

### Or use the new zip

```bash
npm run zip
```

Then upload the new `dclean-cloudflare.zip`.

---

## Cloud Sync (phone + laptop)

1. Free project at supabase.com  
2. Run `supabase/schema.sql` in SQL Editor  
3. App → Cloud Sync → paste URL + anon key on every device  

---

## Local

```bash
npm run dev
```
