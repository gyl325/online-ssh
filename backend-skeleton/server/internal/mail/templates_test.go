package mail

import (
	"strings"
	"testing"
)

func TestRenderVerificationCodeHTML(t *testing.T) {
	html, err := RenderVerificationCodeHTML(VerificationCodeTemplateData{
		Brand:      "Online SSH",
		Code:       "123456",
		Footer:     "This email was sent automatically by Online SSH. Please do not reply to this email.",
		Heading:    "Your verification code",
		Title:      "Online SSH verification code",
		TTLMinutes: 5,
	})
	if err != nil {
		t.Fatalf("render verification code html: %v", err)
	}

	for _, expected := range []string{
		"Online SSH",
		"123456",
		"5 minutes",
		"Please do not reply to this email.",
	} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected rendered html to contain %q, got %s", expected, html)
		}
	}
}
