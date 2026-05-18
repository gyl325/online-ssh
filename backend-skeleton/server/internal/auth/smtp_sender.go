package auth

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
	UseSSL   bool
}

type SMTPSender struct {
	cfg SMTPConfig
}

func NewSMTPSender(cfg SMTPConfig) *SMTPSender {
	return &SMTPSender{cfg: cfg}
}

func (s *SMTPSender) Send(ctx context.Context, message EmailMessage) error {
	if s == nil || strings.TrimSpace(s.cfg.Host) == "" || strings.TrimSpace(s.cfg.From) == "" {
		return ErrEmailSenderUnavailable
	}
	addr := fmt.Sprintf("%s:%d", strings.TrimSpace(s.cfg.Host), s.cfg.Port)
	if s.cfg.Port <= 0 {
		addr = fmt.Sprintf("%s:%d", strings.TrimSpace(s.cfg.Host), 587)
	}

	dialer := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}
	defer conn.Close()

	var client *smtp.Client
	if s.cfg.UseSSL {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: strings.TrimSpace(s.cfg.Host), MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			return fmt.Errorf("smtp tls handshake: %w", err)
		}
		client, err = smtp.NewClient(tlsConn, strings.TrimSpace(s.cfg.Host))
	} else {
		client, err = smtp.NewClient(conn, strings.TrimSpace(s.cfg.Host))
	}
	if err != nil {
		return fmt.Errorf("create smtp client: %w", err)
	}
	defer client.Quit()

	if !s.cfg.UseSSL {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: strings.TrimSpace(s.cfg.Host), MinVersion: tls.VersionTLS12}); err != nil {
				return fmt.Errorf("smtp starttls: %w", err)
			}
		}
	}

	username := strings.TrimSpace(s.cfg.Username)
	if username != "" {
		if err := client.Auth(smtpAuthForConfig(s.cfg)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	from := strings.TrimSpace(s.cfg.From)
	to := normalizeEmail(message.To)
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt to: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	_, writeErr := writer.Write([]byte(formatEmailMessage(from, s.cfg.FromName, to, message.Subject, message.Body, message.HTML)))
	closeErr := writer.Close()
	if writeErr != nil {
		return fmt.Errorf("write smtp message: %w", writeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close smtp message: %w", closeErr)
	}
	return nil
}

func smtpAuthForConfig(cfg SMTPConfig) smtp.Auth {
	username := strings.TrimSpace(cfg.Username)
	host := strings.TrimSpace(cfg.Host)
	if cfg.UseSSL {
		return implicitTLSPlainAuth{username: username, password: cfg.Password}
	}
	return smtp.PlainAuth("", username, cfg.Password, host)
}

type implicitTLSPlainAuth struct {
	username string
	password string
}

func (a implicitTLSPlainAuth) Start(*smtp.ServerInfo) (string, []byte, error) {
	resp := []byte("\x00" + a.username + "\x00" + a.password)
	return "PLAIN", resp, nil
}

func (a implicitTLSPlainAuth) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, fmt.Errorf("unexpected SMTP auth challenge")
	}
	return nil, nil
}

func formatEmailMessage(from string, fromName string, to string, subject string, body string, html string) string {
	displayFrom := strings.TrimSpace(from)
	if name := strings.TrimSpace(fromName); name != "" {
		displayFrom = fmt.Sprintf("%s <%s>", name, from)
	}

	if strings.TrimSpace(html) != "" {
		boundary := "online-ssh-email-boundary"
		return strings.Join([]string{
			fmt.Sprintf("From: %s", displayFrom),
			fmt.Sprintf("To: %s", to),
			fmt.Sprintf("Subject: %s", strings.TrimSpace(subject)),
			"MIME-Version: 1.0",
			fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q", boundary),
			"",
			fmt.Sprintf("--%s", boundary),
			"Content-Type: text/plain; charset=UTF-8",
			"Content-Transfer-Encoding: 8bit",
			"",
			strings.TrimSpace(body),
			"",
			fmt.Sprintf("--%s", boundary),
			"Content-Type: text/html; charset=UTF-8",
			"Content-Transfer-Encoding: 8bit",
			"",
			strings.TrimSpace(html),
			"",
			fmt.Sprintf("--%s--", boundary),
			"",
		}, "\r\n")
	}

	return strings.Join([]string{
		fmt.Sprintf("From: %s", displayFrom),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", strings.TrimSpace(subject)),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		strings.TrimSpace(body),
		"",
	}, "\r\n")
}
