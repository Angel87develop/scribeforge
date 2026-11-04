//! Appearance settings: the automatic theme and the wallpaper.

use scribeforge_lib::settings::{is_wallpaper_file_name, Settings};

#[test]
fn wallpaper_names_are_plain_files_made_by_set_wallpaper() {
    assert!(is_wallpaper_file_name("wallpaper-0a1b2c3d.jpg"));
    assert!(is_wallpaper_file_name("wallpaper-ff.webp"));
    assert!(!is_wallpaper_file_name(""));
    assert!(!is_wallpaper_file_name("wallpaper-.jpg"));
    assert!(!is_wallpaper_file_name("wallpaper-abc.exe"));
    assert!(!is_wallpaper_file_name("wallpaper-zz.jpg"));
    assert!(!is_wallpaper_file_name("../settings.json"));
    assert!(!is_wallpaper_file_name("wallpaper-ab/../../x.png"));
}

#[test]
fn sanitize_keeps_auto_theme_and_clamps_the_wallpaper() {
    let mut s = Settings::default();
    s.general.theme = "auto".into();
    s.appearance.wallpaper.file = "..\\evil.jpg".into();
    s.appearance.wallpaper.visibility = 3.0;
    s.appearance.wallpaper.panel_opacity = f32::NAN;
    s.appearance.wallpaper.blur_px = 500;
    s.sanitize();

    assert_eq!(s.general.theme, "auto");
    let w = &s.appearance.wallpaper;
    assert_eq!(w.file, "");
    assert_eq!(w.visibility, 1.0);
    assert!((w.panel_opacity - 0.82).abs() < 1e-6);
    assert_eq!(w.blur_px, 40);

    s.general.theme = "sepia".into();
    s.sanitize();
    assert_eq!(s.general.theme, "light");
}

#[test]
fn old_settings_files_load_without_a_wallpaper() {
    let s: Settings = serde_json::from_str(r#"{"appearance":{"show_toolbar":false}}"#).unwrap();
    assert!(!s.appearance.show_toolbar);
    assert_eq!(s.appearance.wallpaper.file, "");
    assert!((s.appearance.wallpaper.visibility - 0.8).abs() < 1e-6);
}
