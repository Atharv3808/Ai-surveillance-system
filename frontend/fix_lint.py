import os
import re

files_to_remove_react = [
    "src/App.jsx",
    "src/components/Layout.jsx",
    "src/components/Sidebar.jsx",
    "src/pages/AdminLogin.jsx",
    "src/pages/AlertsLogs.jsx",
    "src/pages/LiveMonitoring.jsx",
]

for f in files_to_remove_react:
    path = os.path.join("/Users/atharvshinde/aipowered system/frontend", f)
    with open(path, "r") as file:
        content = file.read()
    
    # Replace `import React, {` with `import {`
    content = re.sub(r"import React, {\s*", "import { ", content)
    # Replace `import React from 'react';` with empty string
    content = re.sub(r"import React from 'react';\n?", "", content)
    
    with open(path, "w") as file:
        file.write(content)

# Fix Dashboard.jsx duplicate motion
dash_path = "/Users/atharvshinde/aipowered system/frontend/src/pages/Dashboard.jsx"
with open(dash_path, "r") as file:
    dash_content = file.read()
dash_content = dash_content.replace("import { motion } from 'framer-motion';\nimport { motion } from 'framer-motion';", "import { motion } from 'framer-motion';")
with open(dash_path, "w") as file:
    file.write(dash_content)

# Fix AdminLogin.jsx unused err
admin_path = "/Users/atharvshinde/aipowered system/frontend/src/pages/AdminLogin.jsx"
with open(admin_path, "r") as file:
    admin_content = file.read()
admin_content = admin_content.replace("catch (err)", "catch (error)")
admin_content = admin_content.replace("console.error(err)", "console.error(error)")
with open(admin_path, "w") as file:
    file.write(admin_content)

# Fix AlertsLogs.jsx unused e
alerts_path = "/Users/atharvshinde/aipowered system/frontend/src/pages/AlertsLogs.jsx"
with open(alerts_path, "r") as file:
    alerts_content = file.read()
alerts_content = alerts_content.replace("catch (e) {", "catch (error) { console.error(error);")
with open(alerts_path, "w") as file:
    file.write(alerts_content)

