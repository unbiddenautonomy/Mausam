# Printing bills at the counter

The POS is a web page. On the counter (the Posiflex Windows touchscreen), Chrome opens it full screen and prints every bill straight to the Rugtek receipt printer without a print pop-up.

**When a bill prints:**
- **Save & Print**: the order is saved and its bill prints, with every item and price. This happens for dine-in and parcel orders alike.
- **Cash / Pay**: if items were added after the last print, the bill prints again when it's paid.
- **Bill**, or tapping a bill in **Day summary**: prints a copy marked "Duplicate".

The bill is laid out like the old POS's bill. It has the token number at the top, then the restaurant's name, address and phone number, the date and time, DINEIN or PARCEL, and the bill number. Then come the items with their [variation] (Item, Qty, Price, Amount), the total quantity, the Grand Total, and "Thank You !! Visit Again !!". To change the heading or the footer, go to **Manage → Menu → Bills and GST** in the admin app.

## One-time setup on the counter PC (about 15 minutes)

1. **Plug in the Rugtek** by USB and switch it on. Install its Windows driver from the CD or from rugtek.com, picking the 80 mm model. Print a Windows test page to check that it works.
2. **Make it the default printer.** Go to **Settings → Bluetooth & devices → Printers & scanners**, then turn off **Let Windows manage my default printer**. Click the Rugtek and choose **Set as default**.
3. **Set the paper size.** Still in the Rugtek's settings, open **Printing preferences**. Set the paper to **80 mm × receipt** (sometimes called "80(72) x 3276 mm" or "Roll paper 80"), then click **OK**.
4. **Set Chrome's print settings once.** In Chrome, open `https://<your address>/pos/` and log in. Open any bill and press **Ctrl+P**. Set **Destination** to the Rugtek, **Margins** to **None**, **Scale** to **Default**, and turn off **Headers and footers**. Click **Print**. Chrome remembers these settings.
5. **Make a shortcut that prints without the pop-up.** Right-click the desktop and choose **New → Shortcut**. Paste this as the location:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing https://<your address>/pos/
   ```
   Name the shortcut **Mausam POS**. From now on, open the POS from this shortcut. It opens full screen and prints to the default printer straight away. Press **Alt+F4** to close it.
6. **Optional: start the POS when the PC starts.** Press **Win+R**, type `shell:startup` and press Enter. Copy the **Mausam POS** shortcut into that folder.

## If something goes wrong

- **A print pop-up still appears.** Chrome was opened some other way. Close every Chrome window, including any in the system tray, then open the **Mausam POS** shortcut.
- **The bill is cut off, or very small.** Go back to step 3 and check the paper size is 80 mm. Then repeat step 4 and check Margins is **None**.
- **Nothing prints.** Check the printer has paper and its light is green, then print a Windows test page. If the printer is fine, open **Manage → POS options** in the admin app and check **A receipt printer is connected** is switched on.
- **The printer is broken.** Switch **A receipt printer is connected** off in **Manage → POS options**. The POS then shows each bill on screen instead, and billing carries on.
