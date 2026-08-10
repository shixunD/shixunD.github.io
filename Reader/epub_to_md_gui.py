#!/usr/bin/env python3
"""
EPUB to Markdown Converter with Tkinter GUI
Converts EPUB files to Markdown format with metadata and assets
"""

import os
import json
import re
import shutil
import zipfile
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from html import unescape
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
from typing import List, Dict, Tuple, Optional

# 部分 Windows 控制台使用 GBK 编码，直接 print 含特殊符号的文本会抛
# UnicodeEncodeError 导致程序崩溃退出，因此这里尽量把 stdout/stderr
# 切换为 UTF-8，并在无法切换（如无控制台窗口）时静默忽略。
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_print(message: str) -> None:
    """打印信息，即使没有可用的控制台（如 pythonw 启动）也不会报错"""
    try:
        print(message)
    except Exception:
        pass


def check_and_install_dependencies() -> bool:
    """检查并自动安装所需的依赖"""
    required_packages = {
        'html2text': 'html2text'
    }

    missing_packages = []

    for import_name, package_name in required_packages.items():
        try:
            __import__(import_name)
        except ImportError:
            missing_packages.append(package_name)

    if missing_packages:
        safe_print(f"检测到缺失的依赖包: {', '.join(missing_packages)}")
        safe_print("正在自动安装...")

        for package in missing_packages:
            try:
                subprocess.check_call(
                    [sys.executable, "-m", "pip", "install", package])
                safe_print(f"[OK] 成功安装 {package}")
            except (subprocess.CalledProcessError, OSError) as e:
                safe_print(f"[FAIL] 安装 {package} 失败: {e}")
                safe_print(f"请手动安装: pip install {package}")
                return False

        safe_print("所有依赖已安装完成！\n")

    return True


# 检查依赖；任何未预料的异常都不应让窗口一闪而过却看不到原因
try:
    _deps_ok = check_and_install_dependencies()
except Exception as e:
    safe_print(f"依赖检查过程中出现未知错误: {e}")
    _deps_ok = False

if not _deps_ok:
    try:
        input("按回车键退出...")
    except Exception:
        pass
    sys.exit(1)

# 现在安全地导入 html2text
import html2text


class EpubConverter:
    """Core EPUB conversion logic"""

    def __init__(self, output_base_dir: str = "books_src"):
        self.output_base_dir = Path(output_base_dir)
        self.output_base_dir.mkdir(exist_ok=True)

    def slugify(self, text: str, max_length: int = None) -> str:
        """Convert text to URL-friendly slug"""
        text = text.lower()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '-', text)
        text = text.strip('-')

        if max_length and len(text) > max_length:
            # Truncate and ensure it doesn't end with a dash
            text = text[:max_length].rstrip('-')

        return text

    def truncate_slug(self, text: str, max_length: int) -> str:
        """Truncate text and convert to slug with length limit"""
        slug = self.slugify(text)
        if len(slug) > max_length:
            # Truncate and ensure it doesn't end with a dash
            slug = slug[:max_length].rstrip('-')
        return slug

    def truncate_book_slug(self, title: str) -> str:
        """Generate book slug with max 50 characters"""
        return self.truncate_slug(title, 50)

    def truncate_author_slug(self, author: str) -> str:
        """Generate author slug with max 10 characters"""
        return self.truncate_slug(author, 10)

    def truncate_chapter_slug(self, title: str) -> str:
        """Generate chapter slug with max 10 characters"""
        return self.truncate_slug(title, 10)

    def extract_epub_metadata(self, epub_path: str) -> Dict:
        """Extract metadata from EPUB file"""
        metadata = {
            'title': 'Unknown Title',
            'author': 'Unknown Author',
            'cover_image': None
        }

        try:
            with zipfile.ZipFile(epub_path, 'r') as epub:
                # Find OPF file
                container_path = 'META-INF/container.xml'
                if container_path in epub.namelist():
                    container_content = epub.read(container_path)
                    container_root = ET.fromstring(container_content)
                    ns = {
                        'container': 'urn:oasis:names:tc:opendocument:xmlns:container'}
                    rootfile = container_root.find('.//container:rootfile', ns)

                    if rootfile is not None:
                        opf_path = rootfile.get('full-path')
                        opf_content = epub.read(opf_path)
                        opf_root = ET.fromstring(opf_content)

                        # Extract metadata
                        ns_dc = {'dc': 'http://purl.org/dc/elements/1.1/'}

                        title_elem = opf_root.find('.//dc:title', ns_dc)
                        if title_elem is not None and title_elem.text:
                            metadata['title'] = title_elem.text.strip()

                        creator_elem = opf_root.find('.//dc:creator', ns_dc)
                        if creator_elem is not None and creator_elem.text:
                            metadata['author'] = creator_elem.text.strip()

                        # Try to find cover image
                        ns_opf = {'opf': 'http://www.idpf.org/2007/opf'}
                        manifest = opf_root.find('.//opf:manifest', ns_opf)

                        if manifest is not None:
                            # Look for cover image in manifest
                            for item in manifest.findall('.//opf:item', ns_opf):
                                item_id = item.get('id', '').lower()
                                href = item.get('href', '')
                                media_type = item.get('media-type', '')

                                # Check if it's an image and has 'cover' in id or href
                                if media_type.startswith('image/'):
                                    if 'cover' in item_id or 'cover' in href.lower():
                                        metadata['cover_image'] = Path(
                                            href).name
                                        break

                            # If no cover found, check for common cover filenames
                            if not metadata['cover_image']:
                                for item in manifest.findall('.//opf:item', ns_opf):
                                    href = item.get('href', '')
                                    filename = Path(href).name.lower()
                                    if filename in ['cover.jpg', 'cover.jpeg', 'cover.png']:
                                        metadata['cover_image'] = Path(
                                            href).name
                                        break

        except Exception as e:
            print(f"Error extracting metadata: {e}")

        return metadata

    def extract_toc_from_epub(self, epub_path: str) -> List[Dict]:
        """Extract table of contents from EPUB"""
        chapters = []

        try:
            with zipfile.ZipFile(epub_path, 'r') as epub:
                # Find OPF file
                container_path = 'META-INF/container.xml'
                container_content = epub.read(container_path)
                container_root = ET.fromstring(container_content)
                ns = {'container': 'urn:oasis:names:tc:opendocument:xmlns:container'}
                rootfile = container_root.find('.//container:rootfile', ns)

                if rootfile is not None:
                    opf_path = rootfile.get('full-path')
                    opf_dir = str(Path(opf_path).parent)
                    opf_content = epub.read(opf_path)
                    opf_root = ET.fromstring(opf_content)

                    # Get spine items (reading order)
                    ns_opf = {'opf': 'http://www.idpf.org/2007/opf'}
                    spine = opf_root.find('.//opf:spine', ns_opf)
                    manifest = opf_root.find('.//opf:manifest', ns_opf)

                    if spine is not None and manifest is not None:
                        for idx, itemref in enumerate(spine.findall('.//opf:itemref', ns_opf), 1):
                            idref = itemref.get('idref')
                            item = manifest.find(
                                f".//opf:item[@id='{idref}']", ns_opf)

                            if item is not None:
                                href = item.get('href')
                                if href:
                                    # Construct full path
                                    if opf_dir and opf_dir != '.':
                                        full_path = f"{opf_dir}/{href}"
                                    else:
                                        full_path = href

                                    # Read content to get title
                                    try:
                                        content = epub.read(full_path).decode(
                                            'utf-8', errors='ignore')
                                        title, heading_level = self.extract_title_from_html(
                                            content)

                                        if not title:
                                            title = f"Chapter {idx}"
                                            heading_level = 1

                                        chapters.append({
                                            'order': idx,
                                            'title': title,
                                            'heading_level': heading_level,
                                            'content': content,
                                            'original_path': full_path
                                        })
                                    except:
                                        continue

        except Exception as e:
            print(f"Error extracting TOC: {e}")

        return chapters

    def extract_title_from_html(self, html_content: str) -> Tuple[str, int]:
        """Extract title from HTML content and return (title, heading_level)"""
        try:
            # Try to find h1-h6 tags and collect consecutive headings
            titles = []
            heading_level = 1

            for tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                matches = re.finditer(
                    f'<{tag}[^>]*>(.+?)</{tag}>', html_content, re.IGNORECASE | re.DOTALL)
                for match in matches:
                    title_text = re.sub('<[^<]+?>', '', match.group(1))
                    title_text = unescape(title_text).strip()
                    if title_text:
                        titles.append(title_text)
                        if not heading_level or heading_level == 1:
                            # Extract number from h1, h2, etc.
                            heading_level = int(tag[1])

                # If we found titles with this tag, use them
                if titles:
                    # Combine all consecutive headings with newline
                    combined_title = '\n'.join(titles)
                    return combined_title, heading_level

            # Try title tag as fallback
            match = re.search(r'<title>(.+?)</title>',
                              html_content, re.IGNORECASE)
            if match:
                return unescape(match.group(1)).strip(), 1

        except:
            pass

        return "", 1

    def html_to_markdown(self, html_content: str, assets_dir: Path, chapter_slug: str) -> str:
        """Convert HTML to Markdown"""
        h2t = html2text.HTML2Text()
        h2t.ignore_links = False
        h2t.ignore_images = False
        h2t.ignore_emphasis = False
        h2t.body_width = 0

        markdown = h2t.handle(html_content)

        # Fix image paths to point to assets directory
        markdown = re.sub(
            r'!\[(.*?)\]\((.*?)\)',
            lambda m: f'![{m.group(1)}](assets/{Path(m.group(2)).name})',
            markdown
        )

        return markdown

    def extract_assets(self, epub_path: str, output_dir: Path) -> None:
        """Extract images and other assets from EPUB"""
        assets_dir = output_dir / 'assets'
        assets_dir.mkdir(exist_ok=True)

        try:
            with zipfile.ZipFile(epub_path, 'r') as epub:
                for name in epub.namelist():
                    # Extract image files
                    if any(name.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp']):
                        try:
                            content = epub.read(name)
                            filename = Path(name).name
                            output_path = assets_dir / filename

                            with open(output_path, 'wb') as f:
                                f.write(content)
                        except:
                            continue

        except Exception as e:
            print(f"Error extracting assets: {e}")

    def convert_epub(self, epub_path: str, log_callback=None) -> Optional[Dict]:
        """Convert a single EPUB file"""
        try:
            if log_callback:
                log_callback(f"Processing: {Path(epub_path).name}\n")

            # Extract metadata
            metadata = self.extract_epub_metadata(epub_path)
            book_slug = self.truncate_book_slug(metadata['title'])
            book_id = book_slug

            if log_callback:
                log_callback(f"  Book: {metadata['title']} (ID: {book_id})\n")

            # Create output directory
            output_dir = self.output_base_dir / book_id
            if output_dir.exists():
                shutil.rmtree(output_dir)
            output_dir.mkdir(parents=True)

            # Extract chapters
            chapters = self.extract_toc_from_epub(epub_path)

            if not chapters:
                if log_callback:
                    log_callback(f"  Warning: No chapters found\n")
                return None

            if log_callback:
                log_callback(f"  Found {len(chapters)} chapters\n")

            # Extract assets
            self.extract_assets(epub_path, output_dir)

            # Process chapters
            chapter_metadata = []
            chapter_slugs_used = {}

            for chapter in chapters:
                # Use first line of title for slug generation
                title_first_line = chapter['title'].split('\n')[0]
                chapter_slug = self.truncate_chapter_slug(title_first_line)

                # Handle duplicate slugs
                if chapter_slug in chapter_slugs_used:
                    chapter_slugs_used[chapter_slug] += 1
                    chapter_slug = f"{chapter_slug}-{chapter_slugs_used[chapter_slug]}"
                else:
                    chapter_slugs_used[chapter_slug] = 1

                # Generate filename with length check
                chapter_id = f"{chapter['order']:02d}-{chapter_slug}"
                filename = f"{chapter['order']:02d}-{book_slug}--{chapter_slug}.md"

                # Ensure total filename length doesn't exceed reasonable limit (255 chars is filesystem limit)
                # But keep it shorter for practical purposes (150 chars)
                if len(filename) > 150:
                    # Truncate book_slug part if needed
                    max_book_part = 150 - \
                        len(f"{chapter['order']:02d}-") - \
                        len(f"--{chapter_slug}.md")
                    truncated_book = book_slug[:max_book_part].rstrip('-')
                    filename = f"{chapter['order']:02d}-{truncated_book}--{chapter_slug}.md"

                # Convert to Markdown
                markdown = self.html_to_markdown(
                    chapter['content'], output_dir / 'assets', chapter_slug)

                # Save Markdown file
                md_path = output_dir / filename
                with open(md_path, 'w', encoding='utf-8') as f:
                    f.write(markdown)

                # Add heading level prefix to title for TOC display
                heading_level = chapter.get('heading_level', 1)
                level_prefix = '-' * \
                    (heading_level - 1) if heading_level > 1 else ''
                display_title = f"{level_prefix}{chapter['title']}" if level_prefix else chapter['title']

                # Add to metadata
                chapter_metadata.append({
                    'chapter_id': chapter_id,
                    'order': chapter['order'],
                    'title': display_title,
                    'markdown_file': filename
                })

            # Create meta.json
            meta = {
                'book_id': book_id,
                'title': metadata['title'],
                'author': metadata['author'],
                'chapters': chapter_metadata
            }

            meta_path = output_dir / 'meta.json'
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

            if log_callback:
                log_callback(f"  ✓ Successfully converted to {output_dir}\n\n")

            # Return book entry for books.json
            cover_path = None
            if metadata['cover_image']:
                cover_path = f"books_src/{book_id}/assets/{metadata['cover_image']}"

            return {
                'book_id': book_id,
                'title': metadata['title'],
                'author': metadata['author'],
                'cover_image': cover_path,
                'meta_path': f"books_src/{book_id}/meta.json"
            }

        except Exception as e:
            if log_callback:
                log_callback(f"  ✗ Error: {str(e)}\n\n")
            return None


class EpubConverterGUI:
    """Tkinter GUI for EPUB converter"""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("EPUB to Markdown Converter")
        self.root.geometry("700x500")

        self.converter = EpubConverter()
        self.books_entries = []

        self.setup_ui()

    def setup_ui(self):
        """Setup the user interface"""
        # Title
        title_label = tk.Label(
            self.root,
            text="EPUB to Markdown Converter",
            font=("Arial", 16, "bold")
        )
        title_label.pack(pady=10)

        # Select button
        select_btn = tk.Button(
            self.root,
            text="Select EPUB Files",
            command=self.select_files,
            font=("Arial", 12),
            bg="#4CAF50",
            fg="white",
            padx=20,
            pady=10
        )
        select_btn.pack(pady=10)

        # Log area
        log_frame = tk.Frame(self.root)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        tk.Label(log_frame, text="Conversion Log:",
                 font=("Arial", 10)).pack(anchor=tk.W)

        self.log_text = scrolledtext.ScrolledText(
            log_frame,
            height=20,
            font=("Consolas", 9)
        )
        self.log_text.pack(fill=tk.BOTH, expand=True)

    def log(self, message: str):
        """Add message to log"""
        self.log_text.insert(tk.END, message)
        self.log_text.see(tk.END)
        self.root.update()

    def select_files(self):
        """Select EPUB files and start conversion"""
        files = filedialog.askopenfilenames(
            title="Select EPUB Files",
            filetypes=[("EPUB files", "*.epub"), ("All files", "*.*")]
        )

        if not files:
            return

        # Clear previous log and results
        self.log_text.delete(1.0, tk.END)
        self.books_entries = []

        self.log(f"Selected {len(files)} file(s)\n")
        self.log("="*60 + "\n\n")

        # Convert each file
        for epub_path in files:
            entry = self.converter.convert_epub(epub_path, self.log)
            if entry:
                self.books_entries.append(entry)

        # Update books.json
        if self.books_entries:
            self.update_books_json()
        else:
            messagebox.showwarning("No Books Converted",
                                   "No books were successfully converted.")

    def update_books_json(self):
        """Update books.json with new entries at the beginning"""
        books_json_path = Path("books.json")

        try:
            # Read existing books.json
            if books_json_path.exists():
                with open(books_json_path, 'r', encoding='utf-8') as f:
                    existing_books = json.load(f)
            else:
                existing_books = []

            # Add new entries at the beginning
            updated_books = self.books_entries + existing_books

            # Write back to books.json
            with open(books_json_path, 'w', encoding='utf-8') as f:
                json.dump(updated_books, f, ensure_ascii=False, indent=2)

            self.log("="*60 + "\n")
            self.log(
                f"✓ Conversion complete! {len(self.books_entries)} book(s) processed.\n")
            self.log(f"✓ books.json updated successfully.\n")
            self.log(f"✓ New book(s) added at the beginning of the list.\n")

            # Show formatted entries in log
            self.log("\nAdded entries:\n")
            self.log("-"*60 + "\n")
            for entry in self.books_entries:
                json_str = json.dumps(entry, ensure_ascii=False, indent=2)
                self.log(json_str + "\n")
            self.log("-"*60 + "\n")

            messagebox.showinfo(
                "Conversion Complete",
                f"Successfully converted {len(self.books_entries)} book(s)!\n\n"
                f"books.json has been updated.\n"
                f"New book(s) added at the beginning."
            )

        except Exception as e:
            self.log(f"✗ Error updating books.json: {str(e)}\n")
            messagebox.showerror(
                "Error",
                f"Failed to update books.json:\n{str(e)}"
            )

    def run(self):
        """Run the GUI"""
        self.root.mainloop()


def main():
    """主程序入口"""
    app = EpubConverterGUI()
    app.run()


if __name__ == '__main__':
    main()
