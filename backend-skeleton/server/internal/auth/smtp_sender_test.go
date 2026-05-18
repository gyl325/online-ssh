package auth

import (
	"context"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestSMTPAuthAllowsImplicitTLSConnections(t *testing.T) {
	auth := smtpAuthForConfig(SMTPConfig{
		Host:     "smtp.qq.com",
		Username: "sender@example.com",
		Password: "smtp-password",
		UseSSL:   true,
	})

	protocol, response, err := auth.Start(&smtp.ServerInfo{Name: "smtp.qq.com", TLS: false})
	if err != nil {
		t.Fatalf("expected implicit TLS auth to start without net/smtp TLS state, got %v", err)
	}
	if protocol != "PLAIN" {
		t.Fatalf("expected PLAIN auth, got %q", protocol)
	}
	if len(response) == 0 {
		t.Fatal("expected auth response")
	}
}

func TestFormatEmailMessageUsesMultipartHTMLWhenProvided(t *testing.T) {
	raw := formatEmailMessage(
		"noreply@example.com",
		"Online SSH",
		"user@example.com",
		"Verification",
		"Your code is 123456.",
		"<html><body><strong>123456</strong></body></html>",
	)

	if !strings.Contains(raw, "Content-Type: multipart/alternative;") {
		t.Fatalf("expected multipart message, got %s", raw)
	}
	if !strings.Contains(raw, "Content-Type: text/plain; charset=UTF-8") {
		t.Fatalf("expected plain fallback part, got %s", raw)
	}
	if !strings.Contains(raw, "Content-Type: text/html; charset=UTF-8") {
		t.Fatalf("expected html part, got %s", raw)
	}
	if !strings.Contains(raw, "<strong>123456</strong>") {
		t.Fatalf("expected html body, got %s", raw)
	}
}

func TestSMTPSenderLive(t *testing.T) {
	recipient := os.Getenv("SMTP_LIVE_TEST_TO")
	if recipient == "" {
		t.Skip("SMTP_LIVE_TEST_TO is not set")
	}
	port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	sender := NewSMTPSender(SMTPConfig{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     port,
		Username: os.Getenv("SMTP_USERNAME"),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     os.Getenv("SMTP_FROM"),
		FromName: os.Getenv("SMTP_FROM_NAME"),
		UseSSL:   os.Getenv("SMTP_USE_SSL") == "true",
	})

	if err := sender.Send(context.Background(), EmailMessage{
		To:      recipient,
		Subject: "Online SSH SMTP live test",
		Body:    "Online SSH SMTP live test message.",
	}); err != nil {
		t.Fatalf("send live SMTP message: %v", err)
	}
}
