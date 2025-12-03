#!/usr/bin/env python3
"""
Script to convert the entire repository into a single PDF file.
Uses reportlab for PDF generation.
"""

import os
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.colors import grey, black

# Repository root
REPO_ROOT = Path("/home/user/CodeUpgradeEngine")

# Directories to exclude
EXCLUDE_DIRS = {
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.next', '.cache', 'coverage', '.nyc_output', 'venv', '.venv'
}

# File extensions to include
INCLUDE_EXTENSIONS = {
    '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt',
    '.html', '.css', '.scss', '.yaml', '.yml', '.sh', '.sql',
    '.xml', '.toml', '.cfg', '.ini', '.go', '.rs', '.java',
    '.c', '.cpp', '.h', '.hpp', '.env', '.gitignore', '.lock',
    '.cs', '.xaml', '.csproj', '.addin', '.sln', '.resx'  # C# / .NET files
}

# Files to include even without extension
INCLUDE_FILES = {
    'Dockerfile', 'Makefile', 'Procfile', '.env', '.env.example',
    '.gitignore', '.dockerignore', '.prettierrc', '.eslintrc', '.replit'
}


def should_include_file(filepath: Path) -> bool:
    """Check if a file should be included in the PDF."""
    for part in filepath.parts:
        if part in EXCLUDE_DIRS:
            return False

    if filepath.name in INCLUDE_FILES:
        return True

    return filepath.suffix.lower() in INCLUDE_EXTENSIONS


def get_all_files(root: Path) -> list:
    """Get all files that should be included."""
    files = []
    for filepath in root.rglob('*'):
        if filepath.is_file() and should_include_file(filepath):
            if filepath.name == 'repo_to_pdf.py' or filepath.suffix == '.pdf':
                continue
            if filepath.name == 'package-lock.json':
                continue
            files.append(filepath)

    files.sort(key=lambda x: str(x).lower())
    return files


def read_file_safely(filepath: Path) -> str:
    """Read file content safely handling various encodings."""
    encodings = ['utf-8', 'latin-1', 'cp1252']

    for encoding in encodings:
        try:
            with open(filepath, 'r', encoding=encoding) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue

    with open(filepath, 'rb') as f:
        return f.read().decode('utf-8', errors='replace')


def escape_xml(text):
    """Escape special XML characters."""
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    return text


def main():
    print("Collecting files from repository...")
    files = get_all_files(REPO_ROOT)
    print(f"Found {len(files)} files to include")

    output_path = REPO_ROOT / "CodeUpgradeEngine_Repository.pdf"

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=0.5*inch,
        leftMargin=0.5*inch,
        topMargin=0.5*inch,
        bottomMargin=0.5*inch
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        alignment=TA_CENTER,
        spaceAfter=20
    )

    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        alignment=TA_CENTER,
        spaceAfter=10
    )

    file_header_style = ParagraphStyle(
        'FileHeader',
        parent=styles['Heading2'],
        fontSize=10,
        backColor=grey,
        textColor=black,
        borderPadding=5,
        spaceBefore=10,
        spaceAfter=5
    )

    code_style = ParagraphStyle(
        'Code',
        parent=styles['Code'],
        fontSize=6,
        fontName='Courier',
        leading=7,
        leftIndent=0,
        rightIndent=0
    )

    toc_style = ParagraphStyle(
        'TOC',
        parent=styles['Normal'],
        fontSize=8,
        fontName='Courier',
        leading=10
    )

    story = []

    # Title page
    story.append(Spacer(1, 2*inch))
    story.append(Paragraph("CodeUpgradeEngine", title_style))
    story.append(Paragraph("Complete Repository Source Code", subtitle_style))
    story.append(Paragraph(f"Total Files: {len(files)}", subtitle_style))
    story.append(PageBreak())

    # Table of Contents
    story.append(Paragraph("Table of Contents", styles['Heading1']))
    story.append(Spacer(1, 0.2*inch))

    for i, filepath in enumerate(files, 1):
        relative_path = filepath.relative_to(REPO_ROOT)
        toc_entry = f"{i}. {relative_path}"
        story.append(Paragraph(escape_xml(toc_entry), toc_style))

    story.append(PageBreak())

    # File contents
    for i, filepath in enumerate(files, 1):
        print(f"Processing ({i}/{len(files)}): {filepath.relative_to(REPO_ROOT)}")

        relative_path = filepath.relative_to(REPO_ROOT)

        # File header
        header_text = f"File: {relative_path}"
        story.append(Paragraph(escape_xml(header_text), file_header_style))

        # File content
        content = read_file_safely(filepath)

        # Escape content and handle special characters
        content = escape_xml(content)
        content = content.replace('\t', '    ')  # Replace tabs

        # Use Preformatted for code to preserve whitespace
        story.append(Preformatted(content, code_style))
        story.append(PageBreak())

    # Build PDF
    print("Building PDF...")
    doc.build(story)
    print(f"\nPDF created successfully: {output_path}")


if __name__ == "__main__":
    main()
