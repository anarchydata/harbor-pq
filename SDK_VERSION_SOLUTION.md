# SDK Version Mismatch Solution

## Problem
- Old SDK Tools.dll (v1.1.0.0) requires Data.Mashup v1.1.0.0
- New Power BI Desktop Data.Mashup.dll is v1.0.0.0  
- Power BI Desktop doesn't include Tools.dll
- This causes compile-time version mismatch

## Solution Approaches

### Option A: Use Newer SDK DLLs with Conditional Tools.dll
1. Use newer SDK DLLs from Power BI Desktop (v1.0.0.0)
2. Keep old Tools.dll but make it optional
3. Use reflection to load CredentialStore only if Tools.dll is available
4. For simple queries without credentials, CredentialStore might not be needed

### Option B: Try Runtime Binding Redirects
1. Use newer SDK DLLs
2. Keep old Tools.dll but add binding redirect to map v1.1.0.0 → v1.0.0.0
3. May work at runtime even if compile fails

### Option C: Find Matching Tools.dll
- Search for a Tools.dll that matches v1.0.0.0
- Or extract from a newer SDK version

### Option D: Create Minimal CredentialStore Alternative
- If CredentialStore is just for credentials and we're doing simple queries
- Maybe we can create a minimal wrapper or stub

