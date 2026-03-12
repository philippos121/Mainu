# AI:ssociate — Word Plugin

A Microsoft Word Add-in for **AI:ssociate**, a legal AI assistant available via API.

**Select text in Word, ask legal questions, and receive AI-powered answers directly as Word comments.**

## Features

- **Text Selection**: Highlight any text in your Word document
- **Ask Questions**: Type custom legal questions about the selected text
- **Comment Insertion**: AI responses are inserted as Word comments attached to the selected text
- **Ribbon Button**: Quick-analyze selected text with a single click from the ribbon
- **Taskpane Panel**: Full-featured sidebar with question input, response viewer, and history
- **History**: Browse and re-use previous questions and answers
- **Multi-language**: Supports English, German, and French response languages

## Quick Start

### Prerequisites

- Node.js 18+
- Microsoft Word (Desktop or Web)

### Installation

```bash
# Clone and install
cd aissociate-word-plugin
npm install

# Install dev SSL certificates (required for Office Add-ins)
npx office-addin-dev-certs install

# Start development server
npm start
```

### Sideloading the Add-in

#### Word on Windows
1. Open Word
2. Go to **File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs**
3. Add `https://localhost:3000` as a catalog URL
4. Restart Word, then go to **Insert > My Add-ins > Shared Folder**
5. Select **AI:ssociate**

#### Word on the Web
1. Go to [Office.com](https://www.office.com) and open a Word document
2. Click **Insert > Office Add-ins > Upload My Add-in**
3. Upload the `manifest.xml` file from the project root
4. The add-in will appear in the ribbon

#### Word on Mac
1. Copy `manifest.xml` to `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`
2. Restart Word
3. The add-in will appear in the **Insert > My Add-ins** menu

### Configuration

1. Open the AI:ssociate taskpane in Word (click "Open Panel" in the ribbon)
2. Expand **Settings**
3. Enter your AI:ssociate API endpoint URL
4. Enter your API key
5. Select your preferred response language
6. Click **Save Settings**

## Usage

1. **Select text** in your Word document (e.g., a contract clause)
2. **Open the AI:ssociate panel** from the ribbon
3. **Type your question** (e.g., "What risks does this indemnification clause pose?")
4. Click **Ask AI:ssociate**
5. Review the response in the panel
6. Click **Insert as Comment** to attach the answer to the selected text

Alternatively, use the **Ask AI** ribbon button for a one-click analysis that automatically inserts a comment.

## API Contract

The plugin sends POST requests to your configured endpoint:

```json
{
  "question": "What are the key risks?",
  "context": "The selected text from Word...",
  "source": "word-plugin",
  "options": {
    "language": "auto",
    "detail_level": "detailed"
  }
}
```

Expected response format (the plugin tries these fields in order):

```json
{
  "answer": "The AI response text..."
}
```

Supported response fields: `answer`, `response`, `text`.

## Building for Production

```bash
npm run build
```

Output goes to `dist/`. Deploy the contents to any HTTPS-enabled web server and update the URLs in `manifest.xml`.

## Project Structure

```
aissociate-word-plugin/
├── manifest.xml              # Office Add-in manifest
├── webpack.config.js         # Build configuration
├── package.json
├── assets/                   # Icons
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-64.png
│   └── icon-80.png
└── src/
    ├── taskpane/
    │   ├── taskpane.html     # Sidebar UI
    │   ├── taskpane.css      # Styles
    │   └── taskpane.js       # Main logic
    └── commands/
        ├── commands.html     # Ribbon command host page
        └── commands.js       # Ribbon button handler
```

## License

MIT
