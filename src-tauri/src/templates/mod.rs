//! Built-in project templates.
//!
//! Each template defines metadata (id, name, category, description, icon hint)
//! plus a factory function that builds the initial document tree for a new
//! project. Templates are pure data + closures; they do not touch the disk.

pub mod catalog;

pub use catalog::{
    build_project_from_template, category_by_id, categories, find_template, template_preview,
    templates_for_category, CategoryDto, TemplatePreview,
};
